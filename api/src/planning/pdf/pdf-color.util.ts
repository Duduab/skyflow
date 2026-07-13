import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Samples solid fill colors from a rendered PDF page. Text fragments are
 * extracted in scale-1 device space (see extractPdfFragments), so callers pass
 * scale-1 coordinates and this maps them onto the high-res raster.
 *
 * Used by the quantities parser to read the Stage color legend and to map each
 * facade cell to its Stage by background color (the color↔stage link lives in
 * the fill, not the PDF text layer).
 */
export interface ColorSampler {
  /** Clean fill color (#rrggbb) around a scale-1 point, ignoring text glyphs. */
  sample(cx: number, cy: number): string;
  destroy(): void;
}

function toHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Euclidean distance in RGB between two #rrggbb colors. */
export function colorDistance(a: string, b: string): number {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  if (!pa || !pb) return Infinity;
  return Math.sqrt(
    (pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2,
  );
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Render one page and return a sampler. The sampler averages the non-white,
 * non-glyph pixels in a small box around the point — that is the cell fill.
 */
export async function createColorSampler(
  fileBuffer: Buffer,
  pageNumber = 1,
  scale = 3,
): Promise<ColorSampler> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fileBuffer) })
    .promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  const ctx = canvas.getContext('2d');
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  const width = canvas.width;
  const height = canvas.height;

  return {
    sample(cx: number, cy: number): string {
      const px = Math.round(cx * scale);
      const py = Math.round(cy * scale);
      const r = 11;
      const x0 = Math.max(0, px - r);
      const y0 = Math.max(0, py - r);
      const w = Math.min(width - x0, r * 2);
      const h = Math.min(height - y0, r * 2);
      if (w <= 0 || h <= 0) return '#ffffff';
      const data = ctx.getImageData(x0, y0, w, h).data;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const R = data[i];
        const G = data[i + 1];
        const B = data[i + 2];
        const lum = (R + G + B) / 3;
        // skip white/background gaps and dark glyph/gridline pixels
        if (lum > 248 || lum < 90) continue;
        sr += R;
        sg += G;
        sb += B;
        n += 1;
      }
      if (!n) return '#ffffff';
      return toHex(sr / n, sg / n, sb / n);
    },
    destroy() {
      void doc.destroy();
    },
  };
}
