import { IsObject, IsString, MinLength } from 'class-validator';
import type { BomExtractionResult } from '../pdf-analysis.service.js';

export class SavePurchaseOrderDto {
  @IsString()
  projectName!: string;

  @IsString()
  @MinLength(1)
  s3Url!: string;

  @IsObject()
  bomData!: BomExtractionResult;
}
