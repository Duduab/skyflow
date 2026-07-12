import { ProjectDocumentKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** Which of the planning PDFs is being uploaded. */
export const PLANNING_PDF_KINDS: ProjectDocumentKind[] = [
  ProjectDocumentKind.ELEVATION_MAP,
  ProjectDocumentKind.WINDOW_INSTRUCTION_PDF,
  ProjectDocumentKind.QUANTITIES_PDF,
  ProjectDocumentKind.ANGLE_INSTRUCTION_PDF,
  ProjectDocumentKind.CONNECTION_DETAILS_PDF,
];

export class UploadPlanningPdfDto {
  @IsEnum(ProjectDocumentKind)
  @IsIn(PLANNING_PDF_KINDS)
  kind!: ProjectDocumentKind;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  /** Optional target quantity — only meaningful for CONNECTION_DETAILS_PDF (0 = no target). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  targetQty?: number;
}
