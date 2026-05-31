import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CreatePlanningDraftDto } from './dto/create-planning-draft.dto';
import { UpdatePlanningDraftDto } from './dto/update-planning-draft.dto';
import { ApprovePlanningDto } from './dto/approve-planning.dto';
import { UploadProjectDocumentDto } from './dto/upload-project-document.dto';
import { SendProjectDocumentEmailDto } from './dto/send-project-document-email.dto';
import {
  ensureProjectDocsUploadDir,
  ProjectsService,
} from './projects.service';

const PLANNING_UPLOAD_LIMIT = 25 * 1024 * 1024;
const PROJECT_DOC_UPLOAD_MAX = 12 * 1024 * 1024;

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
  createDraft(
    @Body() dto: CreatePlanningDraftDto,
    @Req() req: { user?: { userId?: string } },
  ) {
    return this.projectsService.createPlanningDraft(
      dto.name,
      dto.requirements,
      req.user?.userId ?? null,
    );
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Patch('planning/:id')
  updatePlanningDraft(
    @Param('id') id: string,
    @Body() dto: UpdatePlanningDraftDto,
  ) {
    return this.projectsService.updatePlanningDraft(id, dto.name);
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Delete('planning/:id')
  deletePlanningDraft(@Param('id') id: string) {
    return this.projectsService.deletePlanningDraft(id);
  }

  @Roles(SkyflowRole.ADMIN)
  @Post('documents/:documentId/send-email')
  sendDocumentEmail(
    @Param('documentId') documentId: string,
    @Body() dto: SendProjectDocumentEmailDto,
  ) {
    return this.projectsService.sendProjectDocumentEmail(documentId, dto);
  }

  @Roles(SkyflowRole.ADMIN)
  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (
          _req: Request,
          _file: Express.Multer.File,
          cb: (e: Error | null, d: string) => void,
        ) => {
          cb(null, ensureProjectDocsUploadDir());
        },
        filename: (
          _req: Request,
          _file: Express.Multer.File,
          cb: (e: Error | null, n: string) => void,
        ) => {
          cb(null, `${randomUUID()}.pdf`);
        },
      }),
      limits: { fileSize: PROJECT_DOC_UPLOAD_MAX },
      fileFilter: (_req, file, cb) => {
        const ok =
          /\.pdf$/i.test(file.originalname) ||
          file.mimetype === 'application/pdf' ||
          file.mimetype === 'application/x-pdf';
        cb(
          ok ? null : new BadRequestException('PDF file required'),
          ok,
        );
      },
    }),
  )
  uploadProjectDocument(
    @Param('id') projectId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadProjectDocumentDto,
  ) {
    if (!file?.filename) {
      throw new BadRequestException('file is required');
    }
    return this.projectsService.uploadProjectDocument(projectId, file, body);
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
  approve(@Param('id') id: string, @Body() dto: ApprovePlanningDto) {
    return this.projectsService.approvePlanning(id, dto);
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
