import { IsString, MaxLength } from 'class-validator';

export class UpdateRowNotesDto {
  @IsString()
  @MaxLength(2000)
  notes!: string;
}
