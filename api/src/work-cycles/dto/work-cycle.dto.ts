import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class WorkCycleAssignmentDto {
  @IsString()
  userId!: string;

  @IsIn(['MANAGER', 'WORKER'])
  role!: 'MANAGER' | 'WORKER';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  stationId?: number | null;
}

export class SetWorkCycleAssignmentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkCycleAssignmentDto)
  assignments!: WorkCycleAssignmentDto[];
}

export class SetWorkCycleDailyTargetDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  dailyTargetQty?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(24)
  dailyTargetHours?: number | null;
}
