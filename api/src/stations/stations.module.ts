import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [StationsController],
  providers: [StationsService],
})
export class StationsModule {}
