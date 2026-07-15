import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { CreateUserDailyTargetDto } from './dto/create-user-daily-target.dto.js';

@Controller('users')
@UseGuards(RolesGuard)
@Roles(SkyflowRole.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.findAll();
  }

  @Get('station-managers')
  @Roles(
    SkyflowRole.WORKER,
    SkyflowRole.STATION_MANAGER,
    SkyflowRole.SITE_MANAGER,
    SkyflowRole.ADMIN,
    SkyflowRole.PLANNING,
  )
  stationManagers() {
    return this.users.stationManagers();
  }

  @Get('planning-assignees')
  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  planningAssignees() {
    return this.users.planningAssignees();
  }

  @Get('site-managers')
  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  siteManagers() {
    return this.users.siteManagers();
  }

  @Get('daily-targets/today-alerts')
  todayTargetAlerts() {
    return this.users.getTodayTargetAlerts();
  }

  @Get(':id/performance')
  performance(@Param('id') id: string) {
    return this.users.getPerformance(id);
  }

  @Get(':id/daily-targets')
  dailyTargets(@Param('id') id: string) {
    return this.users.getDailyTargets(id);
  }

  @Post(':id/daily-targets')
  upsertDailyTarget(
    @Param('id') id: string,
    @Body() dto: CreateUserDailyTargetDto,
  ) {
    return this.users.upsertDailyTarget(id, dto);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }
}
