import {
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  ValidateIf,
} from 'class-validator';
import { DeliveryNoteShippingType } from '@prisma/client';

export class UpdateDeliveryNoteDto {
  @IsOptional()
  @IsEnum(DeliveryNoteShippingType)
  shippingType?: DeliveryNoteShippingType;

  @ValidateIf((o: UpdateDeliveryNoteDto) => o.shippingType === 'EXTERNAL')
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  externalPrice?: number | null;
}
