import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MarkCellsDto } from './dto/mark-cells.dto.js';
import { ReportDefectDto } from './dto/report-defect.dto.js';
import { ElevationService } from './elevation.service.js';

@Controller('projects/:projectId/elevation-map')
@UseGuards(JwtAuthGuard)
export class ElevationController {
  constructor(private readonly elevation: ElevationService) {}

  @Get()
  get(@Param('projectId') projectId: string) {
    return this.elevation.getForProject(projectId);
  }

  @Post('cells/mark')
  mark(
    @Param('projectId') projectId: string,
    @Body() dto: MarkCellsDto,
    @Req() req: { user?: { userId?: string; role?: SkyflowRole } },
  ) {
    return this.elevation.markCells({
      projectId,
      cellIds: dto.cellIds,
      done: dto.done,
      user: {
        userId: req.user?.userId ?? '',
        role: req.user?.role ?? SkyflowRole.WORKER,
      },
    });
  }

  @Post('cells/defect')
  reportDefect(
    @Param('projectId') projectId: string,
    @Body() dto: ReportDefectDto,
    @Req() req: { user?: { userId?: string; role?: SkyflowRole } },
  ) {
    return this.elevation.reportDefect({
      projectId,
      cellId: dto.cellId,
      returnedToStationId: dto.returnedToStationId,
      reason: dto.reason,
      user: {
        userId: req.user?.userId ?? '',
        role: req.user?.role ?? SkyflowRole.WORKER,
      },
    });
  }

  @Get('defects/station/:stationId')
  defectsForStation(
    @Param('projectId') projectId: string,
    @Param('stationId') stationId: string,
  ) {
    return this.elevation.listDefectsForStation(
      projectId,
      Number(stationId),
    );
  }

  @Post('defects/:defectId/resolve')
  resolveDefect(@Param('defectId') defectId: string) {
    return this.elevation.resolveDefect(defectId);
  }
}
