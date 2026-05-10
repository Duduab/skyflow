import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { OrdersModule } from './orders/orders.module';
import { StationsModule } from './stations/stations.module';
import { AdminModule } from './admin/admin.module';
import { ShippingModule } from './shipping/shipping.module';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    OrdersModule,
    StationsModule,
    AdminModule,
    ShippingModule,
    ProjectsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
