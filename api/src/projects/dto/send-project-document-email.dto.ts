import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SendProjectDocumentEmailDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  recipients!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  /** Origin for absolute PDF link in mail body (e.g. https://app.example.com). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  origin?: string;
}
