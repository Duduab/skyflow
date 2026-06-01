import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProjectLineMaterial, ProjectMachiningRoute } from '@prisma/client';

export class UpdatePlanningDraftDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  requirements?: string;

  @IsOptional()
  @IsEnum(ProjectLineMaterial)
  lineMaterial?: ProjectLineMaterial;

  @IsOptional()
  @IsEnum(ProjectMachiningRoute)
  machiningRoute?: ProjectMachiningRoute;
}
