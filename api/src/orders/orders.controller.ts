import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(RolesGuard)
@Roles(
  SkyflowRole.WORKER,
  SkyflowRole.STATION_MANAGER,
  SkyflowRole.SITE_MANAGER,
  SkyflowRole.ADMIN,
  SkyflowRole.PLANNING,
)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll() {
    return this.ordersService.findAll();
  }

  @Get(':id/stations')
  stationTotals(@Param('id') id: string) {
    return this.ordersService.stationTotals(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }
}
