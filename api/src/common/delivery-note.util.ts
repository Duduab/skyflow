import { createWriteStream, mkdirSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import {
  DeliveryNoteShippingType,
  DeliveryNoteStatus,
  ProductComponentKind,
} from '@prisma/client';

export interface DeliveryNoteLineItem {
  lineKey: string;
  kind: string;
  profileCode: string | null;
  description: string;
  quantity: number;
  lengthMm: number | null;
  instructionKind: string | null;
}

export interface DeliveryNoteLineItemPreview extends DeliveryNoteLineItem {
  totalQuantity: number;
  shippedQuantity: number;
  remainingQuantity: number;
}

export interface DeliveryNoteExpectedCounts {
  beams: number;
  glazing: number;
  unitized: number;
}

export interface SawLineForDeliveryNote {
  componentKind: ProductComponentKind;
  description: string;
  quantity: number;
  instructionKind: string;
  planningCutLengthMm: number | null;
  sawsProfileCode: string | null;
}

export interface ProductItemForDeliveryNote {
  instructionKind: string;
  label: string;
  components: {
    kind: ProductComponentKind;
    description: string;
    quantity: number;
    sawsProfileCode: string | null;
  }[];
}

export function lineItemKey(item: {
  kind: string;
  profileCode: string | null;
  description: string;
  lengthMm: number | null;
  instructionKind: string | null;
}): string {
  return [
    item.kind,
    item.profileCode ?? '',
    item.description.trim(),
    item.lengthMm ?? '',
    item.instructionKind ?? '',
  ].join('|');
}

export function buildDeliveryNoteLineItems(
  sawLines: SawLineForDeliveryNote[],
  productItems: ProductItemForDeliveryNote[],
): DeliveryNoteLineItem[] {
  const map = new Map<string, DeliveryNoteLineItem>();

  const add = (
    partial: Omit<DeliveryNoteLineItem, 'quantity' | 'lineKey'>,
    qty: number,
  ) => {
    const lineKey = lineItemKey(partial);
    const cur = map.get(lineKey);
    if (cur) {
      cur.quantity += qty;
    } else {
      map.set(lineKey, { ...partial, lineKey, quantity: qty });
    }
  };

  for (const line of sawLines) {
    if ((line.instructionKind ?? '').trim() === 'WINDOW_INSTRUCTION') continue;
    add(
      {
        kind: line.componentKind,
        profileCode: line.sawsProfileCode?.trim() || null,
        description: line.description.trim(),
        lengthMm: line.planningCutLengthMm ?? null,
        instructionKind: line.instructionKind?.trim() || null,
      },
      Math.max(0, line.quantity),
    );
  }

  for (const item of productItems) {
    if (item.instructionKind === 'WINDOW_INSTRUCTION') {
      add(
        {
          kind: 'WINDOW_UNIT',
          profileCode: null,
          description: item.label.trim() || 'יחידת חלון',
          lengthMm: null,
          instructionKind: item.instructionKind,
        },
        1,
      );
    }
    for (const c of item.components) {
      const alreadyFromSaw = sawLines.some(
        (sl) =>
          sl.description.trim() === c.description.trim() &&
          (sl.sawsProfileCode?.trim() || null) ===
            (c.sawsProfileCode?.trim() || null),
      );
      if (alreadyFromSaw && c.sawsProfileCode) continue;
      add(
        {
          kind: c.kind,
          profileCode: c.sawsProfileCode?.trim() || null,
          description: c.description.trim(),
          lengthMm: null,
          instructionKind: item.instructionKind,
        },
        Math.max(0, c.quantity),
      );
    }
  }

  return [...map.values()].sort((a, b) => {
    const ka = `${a.kind}|${a.profileCode ?? ''}|${a.description}`;
    const kb = `${b.kind}|${b.profileCode ?? ''}|${b.description}`;
    return ka.localeCompare(kb, 'he');
  });
}

export function computeShippedByLineKey(
  notes: { status: DeliveryNoteStatus; lineItems: unknown }[],
): Map<string, number> {
  const shipped = new Map<string, number>();
  for (const note of notes) {
    if (note.status !== DeliveryNoteStatus.ACTIVE) continue;
    const items = note.lineItems as DeliveryNoteLineItem[];
    if (!Array.isArray(items)) continue;
    for (const li of items) {
      const key = li.lineKey ?? lineItemKey(li);
      shipped.set(key, (shipped.get(key) ?? 0) + Math.max(0, li.quantity));
    }
  }
  return shipped;
}

export function buildLineItemPreviews(
  catalog: DeliveryNoteLineItem[],
  shippedByKey: Map<string, number>,
): DeliveryNoteLineItemPreview[] {
  return catalog
    .map((item) => {
      const shippedQuantity = shippedByKey.get(item.lineKey) ?? 0;
      const remainingQuantity = Math.max(0, item.quantity - shippedQuantity);
      return {
        ...item,
        totalQuantity: item.quantity,
        shippedQuantity,
        remainingQuantity,
      };
    })
    .filter((i) => i.remainingQuantity > 0);
}

export function resolveSelectedLineItems(
  previews: DeliveryNoteLineItemPreview[],
  selected: { lineKey: string; quantity: number }[],
): DeliveryNoteLineItem[] {
  const previewMap = new Map(previews.map((p) => [p.lineKey, p]));
  const result: DeliveryNoteLineItem[] = [];
  for (const sel of selected) {
    const preview = previewMap.get(sel.lineKey);
    if (!preview) {
      throw new Error(`Unknown lineKey: ${sel.lineKey}`);
    }
    const qty = Math.floor(sel.quantity);
    if (!Number.isFinite(qty) || qty < 1) continue;
    if (qty > preview.remainingQuantity) {
      throw new Error(
        `Quantity exceeds remaining for ${sel.lineKey}: ${qty} > ${preview.remainingQuantity}`,
      );
    }
    result.push({
      lineKey: preview.lineKey,
      kind: preview.kind,
      profileCode: preview.profileCode,
      description: preview.description,
      quantity: qty,
      lengthMm: preview.lengthMm,
      instructionKind: preview.instructionKind,
    });
  }
  if (!result.length) {
    throw new Error('At least one line item with quantity is required');
  }
  return result;
}

export function computeDeliveryNoteExpectedCounts(
  lineItems: DeliveryNoteLineItem[],
  totalItems: number,
): DeliveryNoteExpectedCounts {
  let beams = 0;
  let glazing = 0;
  let unitized = 0;

  for (const li of lineItems) {
    const k = li.kind.toUpperCase();
    if (k === 'BEAM' || k === 'FRAME' || k === 'SASH') {
      beams += li.quantity;
    } else if (k.includes('GLASS')) {
      glazing += li.quantity;
    } else if (k === 'WINDOW_UNIT') {
      unitized += li.quantity;
    }
  }

  if (beams === 0 && glazing === 0 && unitized === 0) {
    return { beams: totalItems, glazing: totalItems, unitized: totalItems };
  }

  return {
    beams: Math.max(beams, unitized > 0 ? unitized : 0),
    glazing: Math.max(glazing, unitized > 0 ? unitized : 0),
    unitized: Math.max(unitized, totalItems > 0 ? totalItems : 0),
  };
}

export function sumExpectedCountsFromNotes(
  notes: { status: DeliveryNoteStatus; lineItems: unknown }[],
  totalItems: number,
): DeliveryNoteExpectedCounts {
  const allItems: DeliveryNoteLineItem[] = [];
  for (const note of notes) {
    if (note.status !== DeliveryNoteStatus.ACTIVE) continue;
    const items = note.lineItems as DeliveryNoteLineItem[];
    if (Array.isArray(items)) allItems.push(...items);
  }
  return computeDeliveryNoteExpectedCounts(allItems, totalItems);
}

export function deliveryNoteUploadDir(): string {
  const fromEnv = process.env['SKYFLOW_DELIVERY_NOTES_DIR']?.trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), '..', 'web', 'public', 'assets', 'delivery-notes');
}

export function ensureDeliveryNoteDir(): string {
  const dir = deliveryNoteUploadDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function deliveryNoteFontPath(): string {
  const candidates = [
    join(process.cwd(), 'assets', 'fonts', 'NotoSansHebrew-Regular.ttf'),
    join(process.cwd(), 'dist', 'assets', 'fonts', 'NotoSansHebrew-Regular.ttf'),
  ];
  return candidates[0]!;
}

export function deliveryNoteAbsolutePath(publicPath: string): string {
  const filename = publicPath.replace(/^\/assets\/delivery-notes\//, '');
  return join(deliveryNoteUploadDir(), filename);
}

export function formatNoteNumber(projectId: string, seq: number): string {
  const short = projectId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  const y = new Date().getFullYear();
  return `DN-${y}-${short}-${String(seq).padStart(3, '0')}`;
}

export interface WriteDeliveryNotePdfOpts {
  projectId: string;
  projectName: string;
  noteNumber: string;
  shippingType: DeliveryNoteShippingType;
  externalPrice: number | null;
  lineItems: DeliveryNoteLineItem[];
  issuedAt: Date;
  partialLabel?: string | null;
}

export function writeDeliveryNotePdf(
  opts: WriteDeliveryNotePdfOpts,
): Promise<{ publicPath: string; absolutePath: string }> {
  const dir = ensureDeliveryNoteDir();
  const filename = `${opts.projectId}-${Date.now()}.pdf`;
  const absolutePath = join(dir, filename);
  const publicPath = `/assets/delivery-notes/${filename}`;
  const fontPath = deliveryNoteFontPath();

  const shippingLabel =
    opts.shippingType === DeliveryNoteShippingType.EXTERNAL
      ? 'משלוח חיצוני'
      : 'משלוח פנימי';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const stream = createWriteStream(absolutePath);
    doc.pipe(stream);

    try {
      doc.registerFont('Hebrew', fontPath);
      doc.font('Hebrew');
    } catch {
      doc.font('Helvetica');
    }

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const rightX = doc.page.margins.left + pageW;

    doc.fontSize(22).text('תעודת משלוח', rightX, doc.y, { align: 'right', width: pageW });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#64748b').text(`SkyFlow · ${opts.projectName}`, rightX, doc.y, {
      align: 'right',
      width: pageW,
    });
    doc.fillColor('#0f172a');
    doc.moveDown(1);

    const metaRows: [string, string][] = [
      ['מספר תעודה', opts.noteNumber],
      ['פרויקט', opts.projectName],
      ['סוג משלוח', shippingLabel],
    ];
    if (
      opts.shippingType === DeliveryNoteShippingType.EXTERNAL &&
      opts.externalPrice != null
    ) {
      metaRows.push(['מחיר משלוח', `₪ ${opts.externalPrice.toFixed(2)}`]);
    }
    if (opts.partialLabel) {
      metaRows.push(['הערה', opts.partialLabel]);
    }
    metaRows.push(['תאריך הפקה', opts.issuedAt.toLocaleString('he-IL')]);

    for (const [label, value] of metaRows) {
      doc.fontSize(10).text(`${label}: ${value}`, rightX, doc.y, {
        align: 'right',
        width: pageW,
      });
    }

    doc.moveDown(1.2);
    doc.fontSize(13).text('פריטים', rightX, doc.y, { align: 'right', width: pageW });
    doc.moveDown(0.5);

    const colWidths = [50, 55, pageW - 50 - 55 - 45 - 140, 45, 140];
    const headers = ['כמות', 'אורך', 'תיאור', 'פרופיל', 'סוג'];
    let x = doc.page.margins.left;
    doc.fontSize(9).fillColor('#475569');
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i]!, x, doc.y, { width: colWidths[i]!, align: 'center' });
      x += colWidths[i]!;
    }
    doc.moveDown(0.8);
    doc.fillColor('#0f172a');

    for (const li of opts.lineItems) {
      if (doc.y > doc.page.height - 80) doc.addPage();
      x = doc.page.margins.left;
      const rowY = doc.y;
      const cells = [
        String(li.quantity),
        li.lengthMm != null ? String(li.lengthMm) : '—',
        li.description,
        li.profileCode ?? '—',
        li.kind,
      ];
      for (let i = 0; i < cells.length; i++) {
        doc.fontSize(8.5).text(cells[i]!, x, rowY, {
          width: colWidths[i]!,
          align: i === 2 ? 'right' : 'center',
        });
        x += colWidths[i]!;
      }
      doc.moveDown(1.1);
    }

    doc.end();
    stream.on('finish', () => resolve({ publicPath, absolutePath }));
    stream.on('error', reject);
    doc.on('error', reject);
  });
}
