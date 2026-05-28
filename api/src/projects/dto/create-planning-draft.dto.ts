import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePlanningDraftDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  requirements?: string;
}
