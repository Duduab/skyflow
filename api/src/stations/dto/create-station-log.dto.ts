import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStationLogDto {
  /** Accept demo non-uuid ids */
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  processedQty!: number;

  @IsOptional()
  @IsString()
  issues?: string;

  @IsOptional()
  @IsString()
  workerId?: string;

  /** Cut length per bar (station 1), millimeters */
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsNumber()
  @Type(() => Number)
  cutLength?: number;

  @IsOptional()
  @IsObject()
  extraPayload?: Record<string, unknown>;
}
