import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { PdfAnalysisModule } from './pdf-analysis/pdf-analysis.module.js';
import { ElevationModule } from './elevation/elevation.module.js';
import { WorkCyclesModule } from './work-cycles/work-cycle.module';
import { TrackingModule } from './tracking/tracking.module';
import { NotificationsModule } from './notifications/notifications.module';

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
    PdfAnalysisModule,
    ElevationModule,
    WorkCyclesModule,
    TrackingModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
