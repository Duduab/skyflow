import { ProjectDocumentKind } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadProjectDocumentDto {
  @IsEnum(ProjectDocumentKind)
  kind!: ProjectDocumentKind;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}
