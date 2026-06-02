import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

export class SetGluingTypeDoneDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  instructionKind!: string;

  @IsBoolean()
  done!: boolean;
}
