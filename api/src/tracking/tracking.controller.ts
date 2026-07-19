import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { AddTrackingBeatDto } from './dto/add-beat.dto';
import { UpdateRowNotesDto } from './dto/update-row-notes.dto';
import { TrackingActor, TrackingService } from './tracking.service';

type AuthedRequest = { user?: { userId?: string; role?: SkyflowRole } };

function actorOf(req: AuthedRequest): TrackingActor {
  return { userId: req.user?.userId, role: req.user?.role };
}

@Controller('projects/:projectId/tracking')
@UseGuards(RolesGuard)
@Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING, SkyflowRole.SITE_MANAGER)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get()
  get(@Param('projectId') projectId: string, @Req() req: AuthedRequest) {
    return this.tracking.getTracking(projectId, actorOf(req));
  }

  @Post('generate')
  generate(@Param('projectId') projectId: string, @Req() req: AuthedRequest) {
    return this.tracking.regenerate(projectId, actorOf(req));
  }

  @Post('rows/:rowId/beats')
  addBeat(
    @Param('projectId') projectId: string,
    @Param('rowId') rowId: string,
    @Body() dto: AddTrackingBeatDto,
    @Req() req: AuthedRequest,
  ) {
    return this.tracking.addBeat(projectId, rowId, dto, actorOf(req));
  }

  @Delete('beats/:beatId')
  deleteBeat(
    @Param('projectId') projectId: string,
    @Param('beatId') beatId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.tracking.deleteBeat(projectId, beatId, actorOf(req));
  }

  @Patch('rows/:rowId/notes')
  updateNotes(
    @Param('projectId') projectId: string,
    @Param('rowId') rowId: string,
    @Body() dto: UpdateRowNotesDto,
    @Req() req: AuthedRequest,
  ) {
    return this.tracking.updateRowNotes(projectId, rowId, dto.notes, actorOf(req));
  }
}
