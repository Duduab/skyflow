import { ProjectDocumentKind } from '@prisma/client';
import { IsEnum, IsIn } from 'class-validator';

/** Document kinds that can be uploaded for a single window type (a "unit"). */
export const WINDOW_TYPE_PDF_KINDS: ProjectDocumentKind[] = [
  ProjectDocumentKind.WINDOW_INSTRUCTION_PDF,
  ProjectDocumentKind.CONNECTION_DETAILS_PDF,
  ProjectDocumentKind.ANGLE_INSTRUCTION_PDF,
];

export class UploadWindowTypePdfDto {
  @IsEnum(ProjectDocumentKind)
  @IsIn(WINDOW_TYPE_PDF_KINDS)
  kind!: ProjectDocumentKind;
}
