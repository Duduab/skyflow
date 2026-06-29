import { ArrayNotEmpty, IsArray, IsBoolean, IsString } from 'class-validator';

export class MarkCellsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  cellIds!: string[];

  @IsBoolean()
  done!: boolean;
}
