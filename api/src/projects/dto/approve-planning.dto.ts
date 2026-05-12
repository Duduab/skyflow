import { IsArray, IsOptional, IsUUID } from 'class-validator';

export class ApprovePlanningDto {
  /** תאימות לאחור — שיבוץ יחיד (עובד או מנהל מסורים) */
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string | null;

  /** מנהל עמדת מסורים (1) — נפרד מעובדים */
  @IsOptional()
  @IsUUID()
  planningSawsManagerUserId?: string | null;

  /** כשמועבר — מצב צוות: עובדי מסורים מרובים (WORKER בלבד) */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  sawsWorkerUserIds?: string[];
}
