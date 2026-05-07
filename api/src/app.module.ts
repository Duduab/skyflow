import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { OrdersModule } from './orders/orders.module';
import { StationsModule } from './stations/stations.module';
import { AdminModule } from './admin/admin.module';
import { ShippingModule } from './shipping/shipping.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    OrdersModule,
    StationsModule,
    AdminModule,
    ShippingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
