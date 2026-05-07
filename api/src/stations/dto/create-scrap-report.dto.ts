import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateScrapReportDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  /** Total length per scrap piece, centimeters */
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  itemLength!: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  scrapQty!: number;
}
