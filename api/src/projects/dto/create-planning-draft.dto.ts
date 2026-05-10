import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreatePlanningDraftDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;
}
