import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SetAssemblyWindowQtyDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  productItemId!: string;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  assembledQty!: number;
}
