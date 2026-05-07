import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SkyflowRole } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsEnum(SkyflowRole)
  role!: SkyflowRole;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ValidateIf(
    (o: CreateUserDto) =>
      o.role === SkyflowRole.STATION_MANAGER ||
      o.role === SkyflowRole.SITE_MANAGER,
  )
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  managedStationId?: number;
}
