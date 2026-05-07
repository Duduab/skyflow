import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { Request } from 'express';

import { OrdersService } from '../orders/orders.service';
import {
  ensureSiteDeliveryDir,
  StationsService,
} from './stations.service';
import { CreateScrapReportDto } from './dto/create-scrap-report.dto.js';
import { CreateStationLogDto } from './dto/create-station-log.dto.js';

@Controller('stations')
export class StationsController {
  constructor(
    private readonly stationsService: StationsService,
    private readonly ordersService: OrdersService,
  ) {}

  @Get(':stationId/context/:projectId')
  async workerContext(
    @Param('stationId', ParseIntPipe) stationId: number,
    @Param('projectId') projectId: string,
  ) {
    return this.stationsService.getWorkerContext(projectId, stationId);
  }

  @Post(':stationId/logs')
  async submitLog(
    @Param('stationId', ParseIntPipe) stationId: number,
    @Body() dto: CreateStationLogDto,
  ) {
    return this.stationsService.createStationLog(stationId, dto);
  }

  @Post(':stationId/scrap')
  async submitScrap(
    @Param('stationId', ParseIntPipe) stationId: number,
    @Body() dto: CreateScrapReportDto,
  ) {
    return this.stationsService.createScrapReport(stationId, dto);
  }

  /** Upload תעודת משלוח for station 7 — query ?projectId= */
  @Post(':stationId/delivery-note')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req: Request, _file: Express.Multer.File, cb: (e: Error | null, d: string) => void) => {
          cb(null, ensureSiteDeliveryDir());
        },
        filename: (req: Request, file: Express.Multer.File, cb: (e: Error | null, n: string) => void) => {
          const raw = req.query['projectId'] ?? 'proj';
          const safe = String(raw).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) ||
            'proj';
          const ext = extname(file.originalname).toLowerCase();
          const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
          const suf = allowed.includes(ext) ? ext : '.pdf';
          cb(null, `${safe}-${Date.now()}${suf}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = [
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
        ].includes(file.mimetype);
        cb(
          ok ? null : new BadRequestException('PDF or image file required'),
          ok,
        );
      },
    }),
  )
  async uploadDeliveryNote(
    @Param('stationId', ParseIntPipe) stationId: number,
    @Query('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (stationId !== 7) {
      throw new BadRequestException('Delivery note upload is only for station 7');
    }
    if (!projectId?.trim()) {
      throw new BadRequestException('projectId query parameter is required');
    }
    if (!file?.filename) {
      throw new BadRequestException('file is required');
    }
    await this.ordersService.findOne(projectId.trim());
    return this.stationsService.ingestSiteDeliveryNote(
      projectId.trim(),
      file.filename,
    );
  }
}
