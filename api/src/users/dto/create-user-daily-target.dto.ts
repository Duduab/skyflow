import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUserDailyTargetDto {
  /** YYYY-MM-DD — defaults to today on the server when omitted */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  targetDate?: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsInt()
  @Min(1)
  @Max(24 * 60)
  targetMinutes!: number;
}
