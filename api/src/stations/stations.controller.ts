import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { Request } from 'express';

import { OrdersService } from '../orders/orders.service';
import {
  ensurePackPhotoDir,
  ensureAssemblyPhotoDir,
  ensureSiteDeliveryDir,
  StationsService,
} from './stations.service';
import { CreateScrapReportDto } from './dto/create-scrap-report.dto.js';
import { CreateStationLogDto } from './dto/create-station-log.dto.js';
import { SetAssemblyWindowQtyDto } from './dto/set-assembly-window-qty.dto.js';
import { SetGluingTypeDoneDto } from './dto/set-gluing-type-done.dto.js';

@Controller('stations')
@UseGuards(RolesGuard)
@Roles(
  SkyflowRole.WORKER,
  SkyflowRole.STATION_MANAGER,
  SkyflowRole.SITE_MANAGER,
  SkyflowRole.ADMIN,
  SkyflowRole.PLANNING,
)
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
    @Req() req: { user?: { userId?: string; role?: SkyflowRole } },
    @Param('stationId', ParseIntPipe) stationId: number,
    @Body() dto: CreateStationLogDto,
  ) {
    if (
      stationId === 7 &&
      req.user?.role !== SkyflowRole.SITE_MANAGER
    ) {
      throw new BadRequestException(
        'Site manager role required for on-site assembly reporting',
      );
    }
    return this.stationsService.createStationLog(
      stationId,
      dto,
      req.user?.userId ?? null,
    );
  }

  @Post('3/assembly-window-qty')
  async setAssemblyWindowQty(
    @Req() req: { user?: { userId?: string } },
    @Body() dto: SetAssemblyWindowQtyDto,
  ) {
    return this.stationsService.setAssemblyWindowQty(
      dto.projectId.trim(),
      dto.productItemId.trim(),
      dto.assembledQty,
      req.user?.userId ?? null,
    );
  }

  /** Station 3 — דיווח הרכבה + תמונה לפי TYPE */
  @Post('3/assembly-type-report')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req: Request, _file: Express.Multer.File, cb) => {
          cb(null, ensureAssemblyPhotoDir());
        },
        filename: (req: Request, file: Express.Multer.File, cb) => {
          const raw = req.query['projectId'] ?? 'proj';
          const safe =
            String(raw).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'proj';
          const kind = String(req.query['instructionKind'] ?? 'type')
            .replace(/[^a-zA-Z0-9_-]/g, '')
            .slice(0, 24);
          const ext = extname(file.originalname).toLowerCase();
          const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
          const suf = allowed.includes(ext) ? ext : '.jpg';
          cb(null, `${safe}-${kind}-${Date.now()}${suf}`);
        },
      }),
      limits: { fileSize: 12 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(
          file.mimetype,
        );
        cb(
          ok ? null : new BadRequestException('Image file required'),
          ok,
        );
      },
    }),
  )
  async submitAssemblyTypeReport(
    @Req() req: { user?: { userId?: string } },
    @Query('projectId') projectId: string,
    @Query('instructionKind') instructionKind: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!projectId?.trim()) {
      throw new BadRequestException('projectId query parameter is required');
    }
    if (!instructionKind?.trim()) {
      throw new BadRequestException('instructionKind query parameter is required');
    }
    if (!file?.filename) {
      throw new BadRequestException('file is required');
    }
    return this.stationsService.submitAssemblyTypeReport(
      projectId.trim(),
      instructionKind.trim(),
      file.filename,
      req.user?.userId ?? null,
    );
  }

  @Post('4/gluing-type')
  async setGluingTypeDone(
    @Req() req: { user?: { userId?: string } },
    @Body() dto: SetGluingTypeDoneDto,
  ) {
    return this.stationsService.setGluingTypeDone(
      dto.projectId.trim(),
      dto.instructionKind.trim(),
      dto.done,
      req.user?.userId ?? null,
    );
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
    @Req() req: { user?: { role?: SkyflowRole } },
    @Param('stationId', ParseIntPipe) stationId: number,
    @Query('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (stationId !== 7) {
      throw new BadRequestException('Delivery note upload is only for station 7');
    }
    if (req.user?.role !== SkyflowRole.SITE_MANAGER) {
      throw new BadRequestException(
        'Site manager role required for delivery note upload',
      );
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

  /** Station 6 — upload pack report photo — query ?projectId=&slotIndex= */
  @Post(':stationId/pack-photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req: Request, _file: Express.Multer.File, cb) => {
          cb(null, ensurePackPhotoDir());
        },
        filename: (req: Request, file: Express.Multer.File, cb) => {
          const raw = req.query['projectId'] ?? 'proj';
          const safe =
            String(raw).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'proj';
          const slot = String(req.query['slotIndex'] ?? '0').replace(
            /[^0-9]/g,
            '',
          );
          const ext = extname(file.originalname).toLowerCase();
          const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
          const suf = allowed.includes(ext) ? ext : '.jpg';
          cb(null, `${safe}-slot${slot}-${Date.now()}${suf}`);
        },
      }),
      limits: { fileSize: 12 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(
          file.mimetype,
        );
        cb(
          ok ? null : new BadRequestException('Image file required'),
          ok,
        );
      },
    }),
  )
  async uploadPackPhoto(
    @Req() req: { user?: { userId?: string } },
    @Param('stationId', ParseIntPipe) stationId: number,
    @Query('projectId') projectId: string,
    @Query('slotIndex') slotIndexRaw: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (stationId !== 6) {
      throw new BadRequestException('Pack photo upload is only for station 6');
    }
    if (!projectId?.trim()) {
      throw new BadRequestException('projectId query parameter is required');
    }
    if (!file?.filename) {
      throw new BadRequestException('file is required');
    }
    const slotIndex = Number(slotIndexRaw);
    if (!Number.isInteger(slotIndex)) {
      throw new BadRequestException('slotIndex query parameter is required');
    }
    return this.stationsService.ingestPackPhoto(
      projectId.trim(),
      slotIndex,
      file.filename,
      req.user?.userId ?? null,
    );
  }
}
