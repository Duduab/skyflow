import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { WorkCycleAssignmentDto } from './work-cycle.dto';

export class LaunchWorkCycleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkCycleAssignmentDto)
  assignments!: WorkCycleAssignmentDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  dailyTargetQty?: number | null;
}
