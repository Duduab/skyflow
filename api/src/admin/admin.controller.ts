import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(RolesGuard)
@Roles(SkyflowRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  getDashboard(@Query('projectId') projectId?: string) {
    return this.adminService.getDashboard(projectId);
  }

  @Get('projects/:projectId/activity')
  @Header('Cache-Control', 'no-store, must-revalidate')
  getProjectActivity(@Param('projectId') projectId: string) {
    return this.adminService.getProjectActivity(projectId);
  }

  @Get('scrap')
  @Header('Cache-Control', 'no-store, must-revalidate')
  getScrap(@Query('projectId') projectId?: string) {
    return this.adminService.getScrapOverview(projectId);
  }

  @Get('simulation')
  getSimulation() {
    return this.adminService.getSimulationSnapshot();
  }
}
