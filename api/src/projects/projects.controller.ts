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
import { UploadPlanningPdfDto } from './dto/upload-planning-pdf.dto';
import { UploadWindowTypePdfDto } from './dto/upload-window-type-pdf.dto';
import { SaveWindowTypePartsDto } from './dto/save-window-type-parts.dto';
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
      dto.lineMaterial,
      dto.machiningRoute,
      dto.angleSourcing,
      dto.projectManagerUserId ?? null,
    );
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Patch('planning/:id')
  updatePlanningDraft(
    @Param('id') id: string,
    @Body() dto: UpdatePlanningDraftDto,
  ) {
    return this.projectsService.updatePlanningDraft(id, dto);
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

  /**
   * @deprecated נתיב ה-Excel (TPI) הוחלף ב-`POST :id/planning/pdf` (זרימת 4 PDF).
   * נשמר לתאימות לאחור ולפרויקטים ישנים בלבד.
   */
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

  /** @deprecated נתיב Excel — הוחלף ב-`GET :id/planning/pdf-preview`. */
  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Get(':id/planning/preview')
  preview(@Param('id') id: string) {
    return this.projectsService.getPlanningPreview(id);
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post(':id/planning/pdf')
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
      limits: { fileSize: PLANNING_UPLOAD_LIMIT },
      fileFilter: (_req, file, cb) => {
        const ok =
          /\.pdf$/i.test(file.originalname) ||
          file.mimetype === 'application/pdf' ||
          file.mimetype === 'application/x-pdf';
        cb(ok ? null : new BadRequestException('PDF file required'), ok);
      },
    }),
  )
  uploadPlanningPdf(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadPlanningPdfDto,
  ) {
    if (!file?.filename) {
      throw new BadRequestException('file is required');
    }
    return this.projectsService.ingestPlanningPdf(
      id,
      file,
      body.kind,
      body.title,
      body.targetQty,
    );
  }

  /** Upload a PDF for a single window type (unit) from the quantities table row. */
  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post(':id/planning/window-types/:windowTypeId/pdf')
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
      limits: { fileSize: PLANNING_UPLOAD_LIMIT },
      fileFilter: (_req, file, cb) => {
        const ok =
          /\.pdf$/i.test(file.originalname) ||
          file.mimetype === 'application/pdf' ||
          file.mimetype === 'application/x-pdf';
        cb(ok ? null : new BadRequestException('PDF file required'), ok);
      },
    }),
  )
  uploadWindowTypePdf(
    @Param('id') id: string,
    @Param('windowTypeId') windowTypeId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadWindowTypePdfDto,
  ) {
    if (!file?.filename) {
      throw new BadRequestException('file is required');
    }
    return this.projectsService.ingestWindowTypePdf(
      id,
      windowTypeId,
      file,
      body.kind,
    );
  }

  /** Upload the elevation-map PDF for a facade GROUP (S / N5 / W2 ...). */
  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post(':id/planning/facade-groups/:groupKey/elevation')
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
      limits: { fileSize: PLANNING_UPLOAD_LIMIT },
      fileFilter: (_req, file, cb) => {
        const ok =
          /\.pdf$/i.test(file.originalname) ||
          file.mimetype === 'application/pdf' ||
          file.mimetype === 'application/x-pdf';
        cb(ok ? null : new BadRequestException('PDF file required'), ok);
      },
    }),
  )
  uploadFacadeGroupElevation(
    @Param('id') id: string,
    @Param('groupKey') groupKey: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.filename) {
      throw new BadRequestException('file is required');
    }
    return this.projectsService.ingestFacadeGroupElevation(id, groupKey, file);
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Get(':id/planning/pdf-preview')
  pdfPreview(@Param('id') id: string) {
    return this.projectsService.getPlanningPdfPreview(id);
  }

  /** Save a planner-reviewed/edited parts mapping for a single window type. */
  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post(':id/planning/window-types/:windowTypeId/parts')
  saveWindowTypeParts(
    @Param('id') id: string,
    @Param('windowTypeId') windowTypeId: string,
    @Body() body: SaveWindowTypePartsDto,
  ) {
    return this.projectsService.saveWindowTypeParts(id, windowTypeId, {
      sections: body.sections,
    });
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Get(':id/planning/resume')
  planningResume(@Param('id') id: string) {
    return this.projectsService.getPlanningResumeItem(id);
  }

  @Roles(SkyflowRole.ADMIN, SkyflowRole.PLANNING)
  @Post(':id/approve-planning')
  approve(
    @Param('id') id: string,
    @Body() dto: ApprovePlanningDto,
    @Req() req: Request & { user?: { userId?: string } },
  ) {
    return this.projectsService.approvePlanning(id, dto, req.user?.userId ?? null);
  }

  @Roles(SkyflowRole.ADMIN)
  @Post(':id/complete')
  complete(
    @Param('id') id: string,
    @Req() req: Request & { user?: { userId?: string } },
  ) {
    return this.projectsService.completeProject(id, req.user?.userId ?? null);
  }

  @Roles(SkyflowRole.ADMIN)
  @Get(':id/can-complete')
  canComplete(@Param('id') id: string) {
    return this.projectsService.canComplete(id).then((ok) => ({ canComplete: ok }));
  }
}
