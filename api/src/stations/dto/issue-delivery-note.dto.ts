import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryNoteShippingType } from '@prisma/client';

export class IssueDeliveryNoteLineDto {
  @IsString()
  lineKey!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class IssueDeliveryNoteDto {
  @IsString()
  projectId!: string;

  @IsEnum(DeliveryNoteShippingType)
  shippingType!: DeliveryNoteShippingType;

  @ValidateIf((o: IssueDeliveryNoteDto) => o.shippingType === 'EXTERNAL')
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  externalPrice?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IssueDeliveryNoteLineDto)
  lineItems!: IssueDeliveryNoteLineDto[];
}
