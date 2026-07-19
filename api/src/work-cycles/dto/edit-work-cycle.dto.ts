import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  WindowPartSectionInputDto,
} from '../../projects/dto/save-window-type-parts.dto';

/**
 * Manual edit of a unit's PDF-mapped data (from step 3 of the planning wizard).
 * Every field is optional — only the touched groups are sent. The service diffs
 * the payload against the stored window type to decide which production station
 * the unit is rerouted to (glass → gluing, beam/profile → saws, angle → laser).
 */
export class EditWorkCycleWindowDto {
  /** כמות היעד של היחידה. */
  @IsOptional()
  @IsInt()
  @Min(0)
  totalQty?: number;

  /** הרכב היחידה (מלמטה למעלה) — מייצג את שכבות הזכוכית. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  composition?: string[];

  /** האם ליחידה יש זוויות משקוף (תחנת לייזר). */
  @IsOptional()
  @IsBoolean()
  hasAngles?: boolean;

  /** קודי הזוויות המשויכים. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  angleCodes?: string[];

  /** טבלאות הסטים (פרופילים/אטמים/אביזרים/שוקונים) שמופו מעמוד 2. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WindowPartSectionInputDto)
  sections?: WindowPartSectionInputDto[];

  /**
   * כשמעלים קובץ הוראות חדש — מפעילים ניתוב מלא מתחנת המסורים (1) ומטה, כי כל
   * מפרט היחידה השתנה.
   */
  @IsOptional()
  @IsBoolean()
  fullReroute?: boolean;
}
