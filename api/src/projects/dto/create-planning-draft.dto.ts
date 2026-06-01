import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProjectLineMaterial, ProjectMachiningRoute } from '@prisma/client';

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
}
