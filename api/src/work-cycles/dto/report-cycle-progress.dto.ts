import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ReportCycleProgressDto {
  @IsString()
  projectId!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cutLength?: number | null;
}
