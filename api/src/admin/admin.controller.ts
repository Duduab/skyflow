import { Controller, Get, Header, Param, Patch, Post, Query, UseGuards, Body } from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { AdminService } from './admin.service';
import { DeliveryNotesService } from '../delivery-notes/delivery-notes.service.js';
import { UpdateDeliveryNoteDto } from './dto/update-delivery-note.dto.js';

@Controller('admin')
@UseGuards(RolesGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly deliveryNotes: DeliveryNotesService,
  ) {}

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Get('dashboard')
  getDashboard(@Query('projectId') projectId?: string) {
    return this.adminService.getDashboard(projectId);
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Get('projects/:projectId/activity')
  @Header('Cache-Control', 'no-store, must-revalidate')
  getProjectActivity(@Param('projectId') projectId: string) {
    return this.adminService.getProjectActivity(projectId);
  }

  @Roles(SkyflowRole.ADMIN)
  @Get('scrap')
  @Header('Cache-Control', 'no-store, must-revalidate')
  getScrap(@Query('projectId') projectId?: string) {
    return this.adminService.getScrapOverview(projectId);
  }

  @Roles(SkyflowRole.ADMIN)
  @Get('simulation')
  getSimulation() {
    return this.adminService.getSimulationSnapshot();
  }

  @Roles(SkyflowRole.ADMIN)
  @Get('delivery-notes')
  @Header('Cache-Control', 'no-store, must-revalidate')
  getDeliveryNotes(@Query('projectId') projectId?: string) {
    return this.deliveryNotes.listForAdmin(projectId);
  }

  @Roles(SkyflowRole.ADMIN)
  @Patch('delivery-notes/:id')
  updateDeliveryNote(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryNoteDto,
  ) {
    return this.deliveryNotes.adminUpdate(id, dto);
  }

  @Roles(SkyflowRole.ADMIN)
  @Post('delivery-notes/:id/cancel')
  cancelDeliveryNote(@Param('id') id: string) {
    return this.deliveryNotes.adminCancel(id);
  }
}
