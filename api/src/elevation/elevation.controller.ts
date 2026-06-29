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
}
