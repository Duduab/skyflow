import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class SaveAssemblyPartsCheckDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  unitCode!: string;

  @IsArray()
  @IsString({ each: true })
  checkedItemKeys!: string[];

  @IsOptional()
  @IsBoolean()
  highlightActive?: boolean;
}
