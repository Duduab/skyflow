import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeliveryNotesModule } from '../delivery-notes/delivery-notes.module.js';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';
import { OrdersModule } from '../orders/orders.module';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WorkCyclesModule } from '../work-cycles/work-cycle.module';

@Module({
  imports: [
    AuthModule,
    OrdersModule,
    DeliveryNotesModule,
    PrismaModule,
    WorkCyclesModule,
  ],
  controllers: [StationsController],
  providers: [StationsService],
})
export class StationsModule {}
