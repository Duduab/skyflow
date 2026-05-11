import { IsOptional, IsUUID } from 'class-validator';

export class ApprovePlanningDto {
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string | null;
}
