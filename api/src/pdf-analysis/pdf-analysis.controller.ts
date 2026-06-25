import {
  Body,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { DrawingPreviewDto } from './dto/drawing-preview.dto.js';
import { SavePurchaseOrderDto } from './dto/save-purchase-order.dto.js';
import {
  AnalyzeAndBackupResponse,
  DrawingPreviewResponse,
  PdfAnalysisService,
} from './pdf-analysis.service.js';

@Controller('pdf-analysis')
@UseGuards(JwtAuthGuard)
export class PdfAnalysisController {
  constructor(private readonly pdfAnalysisService: PdfAnalysisService) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const isPdfMime = file.mimetype === 'application/pdf';
        const isPdfName = file.originalname.toLowerCase().endsWith('.pdf');
        cb(
          isPdfMime || isPdfName
            ? null
            : new BadRequestException('Only PDF files are supported'),
          isPdfMime || isPdfName,
        );
      },
    }),
  )
  async uploadPdf(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AnalyzeAndBackupResponse> {
    if (!file) {
      throw new BadRequestException('file is required (multipart/form-data)');
    }
    return this.pdfAnalysisService.analyzeAndBackup(file.buffer, file.originalname);
  }

  @Post('drawing-preview')
  @HttpCode(HttpStatus.OK)
  async drawingPreview(
    @Body() dto: DrawingPreviewDto,
  ): Promise<DrawingPreviewResponse> {
    return this.pdfAnalysisService.createDrawingPreviewUrl(dto.objectUrl);
  }

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  async saveOrder(
    @Body() dto: SavePurchaseOrderDto,
  ): Promise<AnalyzeAndBackupResponse> {
    return this.pdfAnalysisService.savePurchaseOrder(dto);
  }

  @Get('orders')
  async listOrders(): Promise<AnalyzeAndBackupResponse[]> {
    return this.pdfAnalysisService.listPurchaseOrders();
  }
}
