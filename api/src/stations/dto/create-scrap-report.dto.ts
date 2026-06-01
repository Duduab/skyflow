import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateScrapReportDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  /** Total length per scrap piece, millimeters */
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  itemLength!: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  scrapQty!: number;

  @IsOptional()
  @IsIn(['CATALOG', 'DRAWN'])
  profileKind?: 'CATALOG' | 'DRAWN';

  @IsOptional()
  @IsString()
  profileCode?: string;
}
