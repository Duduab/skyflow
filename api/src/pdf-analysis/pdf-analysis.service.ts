import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MIN_DRAWING_NONWHITE_RATIO,
  renderPlanPdf,
  type RowDrawingCrop,
} from './pdf-render.js';

export interface PlanHeader {
  partNumber: string;
  systemType: string;
  orderNumber: string;
  date: string;
}

/**
 * One BOM row, mapped 1:1 to the PDF table columns, in the exact PDF order:
 * 1. description  (תיאור הפריט)
 * 2. drawing      (שרטוט)        -> drawingImageUrl, filled from extracted images
 * 3. sku          (מק"ט)
 * 4. units        (יחידות)
 * 5. meters       (מ"א)
 * 6. shade        (גוון)
 * 7. supplier     (ספק)
 * 8. unitPrice    (מחיר יחידה)
 * 9. totalCost    (סה"כ עלות)
 * 10. invoice     (חשבונית)
 *
 * Empty cells stay empty strings ("") — never "אין מידע", never invented.
 */
export interface BomItem {
  description: string;
  drawingImageUrl: string;
  sku: string;
  units: string;
  meters: string;
  shade: string;
  supplier: string;
  unitPrice: string;
  totalCost: string;
  invoice: string;
}

export interface BomExtractionResult {
  projectName: string;
  header: PlanHeader;
  items: BomItem[];
  extractionMethod: 'pdf_grid' | 'ai';
}

export interface AnalyzeAndBackupResponse {
  id: string;
  projectName: string;
  s3Url: string;
  bomData: BomExtractionResult;
  createdAt: string;
}

export interface SavePurchaseOrderInput {
  projectName: string;
  s3Url: string;
  bomData: BomExtractionResult;
}

export interface DrawingPreviewResponse {
  url: string;
  expiresInSec: number;
}

@Injectable()
export class PdfAnalysisService {
  private readonly logger = new Logger(PdfAnalysisService.name);
  private readonly anthropic: Anthropic | null;
  private readonly s3: S3Client | null;
  private readonly s3Bucket: string | null;
  private readonly awsRegion: string | null;
  private readonly anthropicModel: string;
  private readonly drawingUrlTtlSec: number;
  private readonly cloudConfigured: boolean;

  constructor(private readonly prisma: PrismaService) {
    const anthropicApiKey = process.env['ANTHROPIC_API_KEY']?.trim();
    const awsAccessKeyId = process.env['AWS_ACCESS_KEY_ID']?.trim();
    const awsSecretAccessKey = process.env['AWS_SECRET_ACCESS_KEY']?.trim();
    const awsRegion = process.env['AWS_REGION']?.trim();
    const s3Bucket = process.env['AWS_S3_BUCKET']?.trim();
    const anthropicModel = process.env['ANTHROPIC_MODEL']?.trim();

    this.cloudConfigured = Boolean(
      anthropicApiKey &&
        awsAccessKeyId &&
        awsSecretAccessKey &&
        awsRegion &&
        s3Bucket,
    );

    if (!this.cloudConfigured) {
      this.logger.warn(
        'PDF analysis disabled — set ANTHROPIC_API_KEY and AWS S3 env vars to enable upload/analyze',
      );
      this.anthropic = null;
      this.s3 = null;
      this.s3Bucket = null;
      this.awsRegion = null;
      this.anthropicModel = anthropicModel || 'claude-3-5-sonnet-latest';
      this.drawingUrlTtlSec = 600;
      return;
    }

    this.anthropic = new Anthropic({ apiKey: anthropicApiKey! });
    this.s3 = new S3Client({
      region: awsRegion!,
      credentials: {
        accessKeyId: awsAccessKeyId!,
        secretAccessKey: awsSecretAccessKey!,
      },
    });
    this.s3Bucket = s3Bucket!;
    this.awsRegion = awsRegion!;
    this.anthropicModel = anthropicModel || 'claude-3-5-sonnet-latest';
    this.drawingUrlTtlSec = 600;
  }

  private assertCloudConfigured(): void {
    if (!this.cloudConfigured || !this.anthropic || !this.s3 || !this.s3Bucket || !this.awsRegion) {
      throw new ServiceUnavailableException(
        'PDF analysis is not configured on this server (ANTHROPIC_API_KEY and AWS S3 credentials required)',
      );
    }
  }

  async analyzeAndBackup(
    fileBuffer: Buffer,
    originalName: string,
  ): Promise<AnalyzeAndBackupResponse> {
    this.assertCloudConfigured();
    if (!fileBuffer.byteLength) {
      throw new BadRequestException('Uploaded PDF is empty');
    }

    const rendered = await renderPlanPdf(fileBuffer);
    const backupPromise = this.uploadToS3(fileBuffer, originalName);

    // Prefer the deterministic grid+text extraction (1:1 with the PDF, no OCR).
    // Fall back to Claude vision only for PDFs without a usable grid/text layer.
    let extraction: BomExtractionResult;
    let hasDrawing: boolean[];
    const rowCrops: RowDrawingCrop[] = rendered.rowCrops;
    if (rendered.header && rendered.items.length > 0) {
      extraction = {
        projectName: rendered.header.partNumber || 'Manufacturing Plan',
        header: rendered.header,
        items: rendered.items,
        extractionMethod: 'pdf_grid',
      };
      hasDrawing = rendered.hasDrawing;
    } else {
      const ai = await this.extractBomWithClaude(rendered.pageImageBase64);
      extraction = ai.result;
      hasDrawing = ai.hasDrawing;
    }

    const [s3Url, drawingImageUrls] = await Promise.all([
      backupPromise,
      this.uploadRowDrawings(rowCrops, hasDrawing),
    ]);

    const bomData = this.attachDrawings(extraction, drawingImageUrls);

    // Analysis is a preview only — persistence happens on explicit save
    // (the "save purchase order" action), so nothing is stored yet here.
    return {
      id: '',
      projectName: bomData.projectName,
      s3Url,
      bomData,
      createdAt: new Date().toISOString(),
    };
  }

  /** Persist an analyzed plan as a purchase order (explicit save action). */
  async savePurchaseOrder(
    input: SavePurchaseOrderInput,
  ): Promise<AnalyzeAndBackupResponse> {
    if (!input?.bomData || !input.s3Url) {
      throw new BadRequestException('bomData and s3Url are required');
    }
    const record = await this.prisma.manufacturingPlan.create({
      data: {
        projectName:
          input.projectName || input.bomData.projectName || 'Purchase Order',
        s3Url: input.s3Url,
        bomData: input.bomData as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toResponse(record, input.bomData);
  }

  /** All saved purchase orders, newest first. */
  async listPurchaseOrders(): Promise<AnalyzeAndBackupResponse[]> {
    const records = await this.prisma.manufacturingPlan.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) =>
      this.toResponse(record, record.bomData as unknown as BomExtractionResult),
    );
  }

  private async extractBomWithClaude(
    pageImageBase64: string,
  ): Promise<{ result: BomExtractionResult; hasDrawing: boolean[] }> {
    try {
      const result = await this.anthropic!.messages.create({
        model: this.anthropicModel,
        max_tokens: 4000,
        temperature: 0,
        system: this.buildExtractionSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: pageImageBase64,
                },
              },
              {
                type: 'text',
                text:
                  'Read the attached high-resolution image of the manufacturing-order page ' +
                  'and extract its table EXACTLY as it visually appears. Read the Hebrew text ' +
                  'carefully from the image itself. Map each value to the column it physically ' +
                  'sits under in the grid (including empty cells). Return only the JSON ' +
                  'described in your instructions.',
              },
            ],
          },
        ],
      });

      const textPayload = result.content
        .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
        .filter((text) => text.length > 0)
        .join('\n')
        .trim();

      if (!textPayload) {
        throw new BadGatewayException('Claude returned an empty response');
      }

      const parsed = this.parseClaudeJson(textPayload);
      return this.normalizeExtraction(parsed);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof BadGatewayException) {
        throw error;
      }
      throw new BadGatewayException('Failed to analyze PDF with Claude');
    }
  }

  private buildExtractionSystemPrompt(): string {
    return [
      'You are a strict data-extraction engine for Hebrew (RTL) manufacturing order PDFs.',
      'You receive a high-resolution image of the order page. LOOK at the visual table grid',
      '(including its borders and empty cells) and copy the order EXACTLY as it appears. Read',
      'the Hebrew letters carefully from the image. Never translate, swap, guess or invent any',
      'value, and never shift a value into a neighbouring column.',
      '',
      'The order has a header block and ONE main table.',
      'The table has EXACTLY these 10 columns, in this right-to-left order:',
      '1. description  = "תיאור הפריט"  (item description text — the right-most column)',
      '2. drawing      = "שרטוט"        (a drawing image — do NOT transcribe it; instead set hasDrawing)',
      '3. sku          = "מק\u05f4ט"     (catalog number / part code)',
      '4. units        = "יחידות"       (number of units)',
      '5. meters       = "מ\u05f4א"      (linear meters)',
      '6. shade        = "גוון"         (color / shade, e.g. "Steel hot-dip coated", "שחור", "Ral 9005")',
      '7. supplier     = "ספק"          (supplier name, e.g. "RP Technik", "פרופאל")',
      '8. unitPrice    = "מחיר יחידה"   (price per unit)',
      '9. totalCost    = "סה\u05f4כ עלות" (total cost)',
      '10. invoice     = "חשבונית"      (invoice)',
      '',
      'CRITICAL RULES:',
      '- Determine each cell by its horizontal position under the column header. A value belongs',
      '  to a column ONLY if it sits directly beneath that header in the grid.',
      '- "גוון" (shade) and "ספק" (supplier) are SEPARATE adjacent columns. Do not merge them.',
      '  Example: if a cell shows "Steel hot-dip coated" under גוון and "RP Technik" under ספק,',
      '  then shade="Steel hot-dip coated" and supplier="RP Technik".',
      '- "יחידות" (units) and "מ\u05f4א" (meters) are SEPARATE adjacent columns. If "יחידות" is',
      '  empty for a row, keep units="" and still place the מ\u05f4א number in meters — never move it',
      '  to units or to totalCost.',
      '- If a cell is empty in the PDF, return an empty string "" for it. Never write "אין מידע",',
      '  "N/A", "-" or any placeholder.',
      '- Keep numbers exactly as written (e.g. "231", "6.00", "2,854.00"). Do not reformat or round.',
      '- Include EVERY row of the table, even rows where most cells are empty.',
      '- For each row set hasDrawing=true only if the שרטוט cell visibly contains a drawing/figure,',
      '  and false if that cell is empty or contains only text (e.g. "יתוכנן בהמשך").',
      '- Output ONLY raw JSON (no markdown fences, no comments, no extra text).',
      '',
      'Output JSON schema:',
      '{',
      '  "projectName": string,',
      '  "header": { "partNumber": string, "systemType": string, "orderNumber": string, "date": string },',
      '  "items": [',
      '    { "description": string, "hasDrawing": boolean, "sku": string, "units": string, "meters": string, "shade": string, "supplier": string, "unitPrice": string, "totalCost": string, "invoice": string }',
      '  ]',
      '}',
      'For header fields that are missing, also use "".',
    ].join('\n');
  }

  private parseClaudeJson(payload: string): unknown {
    let cleaned = payload
      .replace(/^```json\s*/i, '')
      .replace(/^```/, '')
      .replace(/```$/, '')
      .trim();
    // Be tolerant of any leading/trailing prose around the JSON object.
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new BadGatewayException('Claude returned invalid JSON');
    }
  }

  private normalizeExtraction(value: unknown): {
    result: BomExtractionResult;
    hasDrawing: boolean[];
  } {
    if (!value || typeof value !== 'object') {
      throw new BadGatewayException('BOM payload must be an object');
    }
    const rec = value as Record<string, unknown>;
    const headerRec = (rec['header'] ?? {}) as Record<string, unknown>;
    const header: PlanHeader = {
      partNumber: this.asText(headerRec['partNumber']),
      systemType: this.asText(headerRec['systemType']),
      orderNumber: this.asText(headerRec['orderNumber']),
      date: this.asText(headerRec['date']),
    };

    const rawItems = Array.isArray(rec['items']) ? rec['items'] : [];
    const hasDrawing: boolean[] = [];
    const items: BomItem[] = rawItems.map((raw) => {
      const i = (raw ?? {}) as Record<string, unknown>;
      hasDrawing.push(i['hasDrawing'] === true);
      return {
        description: this.asText(i['description']),
        drawingImageUrl: '',
        sku: this.asText(i['sku']),
        units: this.asText(i['units']),
        meters: this.asText(i['meters']),
        shade: this.asText(i['shade']),
        supplier: this.asText(i['supplier']),
        unitPrice: this.asText(i['unitPrice']),
        totalCost: this.asText(i['totalCost']),
        invoice: this.asText(i['invoice']),
      };
    });

    const projectName =
      this.asText(rec['projectName']) || header.partNumber || 'Manufacturing Plan';

    return {
      result: { projectName, header, items, extractionMethod: 'ai' },
      hasDrawing,
    };
  }

  /**
   * Normalize a model value into a clean string. Drops any placeholder the model
   * might still emit so empty cells stay truly empty.
   */
  private asText(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = String(value).replace(/\s+/g, ' ').trim();
    const placeholders = ['אין מידע', 'n/a', 'na', '-', '—', 'null', 'undefined'];
    if (placeholders.includes(text.toLowerCase())) return '';
    return text;
  }

  /**
   * Attach the per-row drawing URLs to each BOM item by row index. The crops and
   * the Claude items are both in top-to-bottom order, so index `i` always refers
   * to the same physical row — no off-by-one shifting possible.
   */
  private attachDrawings(
    extraction: BomExtractionResult,
    drawingImageUrls: string[],
  ): BomExtractionResult {
    const items = extraction.items.map((item, index) => ({
      ...item,
      drawingImageUrl: drawingImageUrls[index] ?? '',
    }));
    return { ...extraction, items };
  }

  /**
   * Upload the drawing-cell crop for each data row that (a) Claude flagged as
   * containing a figure and (b) is not a near-blank cell. Returns a URL per row
   * index (empty string when the row has no drawing).
   */
  private async uploadRowDrawings(
    crops: RowDrawingCrop[],
    hasDrawing: boolean[],
  ): Promise<string[]> {
    const day = new Date().toISOString().slice(0, 10);
    const tasks = crops.map(async (crop, index) => {
      const keep =
        hasDrawing[index] === true &&
        crop.pngBuffer.length > 0 &&
        crop.nonWhiteRatio > MIN_DRAWING_NONWHITE_RATIO;
      if (!keep) return '';
      try {
        const key = `manufacturing-plans/drawings/${day}/${randomUUID()}-${index}.png`;
        await this.s3!.send(
          new PutObjectCommand({
            Bucket: this.s3Bucket!,
            Key: key,
            Body: crop.pngBuffer,
            ContentType: 'image/png',
          }),
        );
        return `https://${this.s3Bucket!}.s3.${this.awsRegion!}.amazonaws.com/${key}`;
      } catch {
        // A failed drawing upload must not fail the whole analysis.
        return '';
      }
    });
    return Promise.all(tasks);
  }

  async createDrawingPreviewUrl(objectUrl: string): Promise<DrawingPreviewResponse> {
    this.assertCloudConfigured();
    const key = this.extractS3Key(objectUrl);
    const command = new GetObjectCommand({
      Bucket: this.s3Bucket!,
      Key: key,
    });
    try {
      const url = await getSignedUrl(this.s3!, command, {
        expiresIn: this.drawingUrlTtlSec,
      });
      return {
        url,
        expiresInSec: this.drawingUrlTtlSec,
      };
    } catch {
      throw new InternalServerErrorException('Failed to create drawing preview URL');
    }
  }

  private extractS3Key(objectUrl: string): string {
    const raw = objectUrl.trim();
    if (!raw) {
      throw new BadRequestException('drawing URL is missing');
    }
    const pattern = new RegExp(
      `^https://${this.s3Bucket!}\\.s3\\.${this.awsRegion!}\\.amazonaws\\.com/(.+)$`,
      'i',
    );
    const match = raw.match(pattern);
    if (!match?.[1]) {
      throw new BadRequestException('drawing URL does not belong to configured S3 bucket');
    }
    return decodeURIComponent(match[1]);
  }

  private async uploadToS3(fileBuffer: Buffer, originalName: string): Promise<string> {
    this.assertCloudConfigured();
    const fileExt = extname(originalName).toLowerCase() || '.pdf';
    const key = `manufacturing-plans/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${fileExt}`;
    try {
      await this.s3!.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket!,
          Key: key,
          Body: fileBuffer,
          ContentType: 'application/pdf',
        }),
      );
      return `https://${this.s3Bucket!}.s3.${this.awsRegion!}.amazonaws.com/${key}`;
    } catch {
      throw new InternalServerErrorException('Failed to upload PDF backup to S3');
    }
  }

  private toResponse(
    record: {
      id: string;
      projectName: string;
      s3Url: string;
      createdAt: Date;
    },
    bomData: BomExtractionResult,
  ): AnalyzeAndBackupResponse {
    return {
      id: record.id,
      projectName: record.projectName,
      s3Url: record.s3Url,
      bomData,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
