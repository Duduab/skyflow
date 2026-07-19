import { TrackingPhase } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class AddTrackingBeatDto {
  @IsEnum(TrackingPhase)
  phase!: TrackingPhase;

  /** YYYY-MM-DD */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurredOn!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsOptional()
  @IsString()
  deliveryNoteId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
