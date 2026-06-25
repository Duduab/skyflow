import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PdfAnalysisController } from './pdf-analysis.controller.js';
import { PdfAnalysisService } from './pdf-analysis.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PdfAnalysisController],
  providers: [PdfAnalysisService],
})
export class PdfAnalysisModule {}
