import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { WorkCycleService } from './work-cycle.service';
import { LaunchWorkCycleDto } from './dto/launch-work-cycle.dto';
import { EditWorkCycleWindowDto } from './dto/edit-work-cycle.dto';
import {
  SetWorkCycleAssignmentsDto,
  SetWorkCycleDailyTargetDto,
} from './dto/work-cycle.dto';

type AuthedRequest = { user?: { userId?: string } };

@Controller('projects/:projectId/work-cycles')
@UseGuards(RolesGuard)
export class WorkCycleController {
  constructor(private readonly workCycles: WorkCycleService) {}

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Get()
  list(@Param('projectId') projectId: string) {
    return this.workCycles.listByProject(projectId);
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Get(':cycleId')
  get(
    @Param('projectId') projectId: string,
    @Param('cycleId') cycleId: string,
  ) {
    return this.workCycles.getCycle(projectId, cycleId);
  }

  /** Full detail view: mapped data + station journey (progress + logs). */
  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Get(':cycleId/details')
  details(
    @Param('projectId') projectId: string,
    @Param('cycleId') cycleId: string,
  ) {
    return this.workCycles.getCycleDetails(projectId, cycleId);
  }

  /** Edit the unit's mapped data and reroute it to the affected station(s). */
  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Patch(':cycleId')
  edit(
    @Param('projectId') projectId: string,
    @Param('cycleId') cycleId: string,
    @Body() dto: EditWorkCycleWindowDto,
  ) {
    return this.workCycles.editCycleWindow(projectId, cycleId, dto);
  }

  /** Delete a draft unit (window type + cascade). */
  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Delete(':cycleId')
  @HttpCode(204)
  remove(
    @Param('projectId') projectId: string,
    @Param('cycleId') cycleId: string,
  ) {
    return this.workCycles.deleteCycle(projectId, cycleId);
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post(':cycleId/assignments')
  setAssignments(
    @Param('projectId') projectId: string,
    @Param('cycleId') cycleId: string,
    @Body() dto: SetWorkCycleAssignmentsDto,
  ) {
    return this.workCycles.setAssignments(
      projectId,
      cycleId,
      dto.assignments ?? [],
    );
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post(':cycleId/daily-target')
  setDailyTarget(
    @Param('projectId') projectId: string,
    @Param('cycleId') cycleId: string,
    @Body() dto: SetWorkCycleDailyTargetDto,
  ) {
    return this.workCycles.setDailyTarget(
      projectId,
      cycleId,
      dto.dailyTargetQty ?? null,
      dto.dailyTargetHours ?? null,
    );
  }

  /** Save assignments + daily target and open a DRAFT cycle on the production floor. */
  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post(':cycleId/launch')
  launch(
    @Param('projectId') projectId: string,
    @Param('cycleId') cycleId: string,
    @Body() dto: LaunchWorkCycleDto,
    @Req() req: AuthedRequest,
  ) {
    return this.workCycles.launchCycle(
      projectId,
      cycleId,
      dto.assignments ?? [],
      dto.dailyTargetQty ?? null,
      dto.dailyTargetHours ?? null,
      req.user?.userId ?? null,
    );
  }
}
