import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ProjectAngleSourcing,
  ProjectLineMaterial,
  ProjectMachiningRoute,
} from '@prisma/client';

export class CreatePlanningDraftDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  requirements?: string;

  @IsEnum(ProjectLineMaterial)
  lineMaterial!: ProjectLineMaterial;

  @IsEnum(ProjectMachiningRoute)
  machiningRoute!: ProjectMachiningRoute;

  /** מקור זוויות ANG — לייזר פנימי / ספק חיצוני */
  @IsOptional()
  @IsEnum(ProjectAngleSourcing)
  angleSourcing?: ProjectAngleSourcing;

  /** מנהל הפרויקט (מנהל אתר) */
  @IsOptional()
  @IsString()
  projectManagerUserId?: string | null;
}
