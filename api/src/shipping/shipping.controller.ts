import { Controller, Get } from '@nestjs/common';
import { ShippingService } from './shipping.service';

@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('ready')
  getReady() {
    return this.shippingService.getReadyToShip();
  }
}
