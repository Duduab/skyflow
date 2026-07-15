import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class WindowPartRowInputDto {
  @IsOptional()
  @IsString()
  partNumber?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  blockNumber?: string;
}

export class WindowPartSectionInputDto {
  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WindowPartRowInputDto)
  rows!: WindowPartRowInputDto[];
}

export class SaveWindowTypePartsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WindowPartSectionInputDto)
  sections!: WindowPartSectionInputDto[];
}
