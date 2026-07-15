import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { WorkCycleService } from './work-cycle.service';
import { LaunchWorkCycleDto } from './dto/launch-work-cycle.dto';
import {
  SetWorkCycleAssignmentsDto,
  SetWorkCycleDailyTargetDto,
} from './dto/work-cycle.dto';

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
    );
  }

  /** Save assignments + daily target and open a DRAFT cycle on the production floor. */
  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post(':cycleId/launch')
  launch(
    @Param('projectId') projectId: string,
    @Param('cycleId') cycleId: string,
    @Body() dto: LaunchWorkCycleDto,
  ) {
    return this.workCycles.launchCycle(
      projectId,
      cycleId,
      dto.assignments ?? [],
      dto.dailyTargetQty ?? null,
    );
  }
}
