import { IsString, MinLength } from 'class-validator';

export class DrawingPreviewDto {
  @IsString()
  @MinLength(1)
  objectUrl!: string;
}
