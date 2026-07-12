import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ReportDefectDto {
  @IsString()
  cellId!: string;

  /** target station to return the unit to (1–8) */
  @IsInt()
  @Min(1)
  @Max(8)
  returnedToStationId!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  reason!: string;
}
