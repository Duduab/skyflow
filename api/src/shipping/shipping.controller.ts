import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { ShippingService } from './shipping.service';

@Controller('shipping')
@UseGuards(RolesGuard)
@Roles(SkyflowRole.ADMIN)
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('ready')
  getReady() {
    return this.shippingService.getReadyToShip();
  }
}
