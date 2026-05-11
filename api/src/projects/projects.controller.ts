import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CreatePlanningDraftDto } from './dto/create-planning-draft.dto';
import { ProjectsService } from './projects.service';

const PLANNING_UPLOAD_LIMIT = 25 * 1024 * 1024;

@Controller('projects')
@UseGuards(RolesGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Get('planning/list')
  listPlanningDrafts() {
    return this.projectsService.listPlanningDrafts();
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post()
  createDraft(@Body() dto: CreatePlanningDraftDto) {
    return this.projectsService.createPlanningDraft(dto.name);
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post(':id/planning/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: PLANNING_UPLOAD_LIMIT },
      fileFilter: (_req, file, cb) => {
        const ok =
          /\.(xlsx|xls|csv)$/i.test(file.originalname) ||
          [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/csv',
            'application/csv',
            'application/vnd.ms-excel.sheet.macroEnabled.12',
          ].includes(file.mimetype);
        cb(
          ok ? null : new BadRequestException('Excel or CSV file required'),
          ok,
        );
      },
    }),
  )
  uploadPlanning(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    return this.projectsService.ingestPlanningFile(id, file.buffer);
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Get(':id/planning/preview')
  preview(@Param('id') id: string) {
    return this.projectsService.getPlanningPreview(id);
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post(':id/approve-planning')
  approve(@Param('id') id: string) {
    return this.projectsService.approvePlanning(id);
  }

  @Roles(SkyflowRole.ADMIN)
  @Post(':id/complete')
  complete(@Param('id') id: string) {
    return this.projectsService.completeProject(id);
  }

  @Roles(SkyflowRole.ADMIN)
  @Get(':id/can-complete')
  canComplete(@Param('id') id: string) {
    return this.projectsService.canComplete(id).then((ok) => ({ canComplete: ok }));
  }
}
