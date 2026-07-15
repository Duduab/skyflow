import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkCyclesModule } from '../work-cycles/work-cycle.module';
import { ElevationAssetsController } from './elevation-assets.controller.js';
import { ElevationController } from './elevation.controller.js';
import { ElevationService } from './elevation.service.js';

@Module({
  imports: [AuthModule, WorkCyclesModule],
  controllers: [ElevationController, ElevationAssetsController],
  providers: [ElevationService],
  exports: [ElevationService],
})
export class ElevationModule {}
