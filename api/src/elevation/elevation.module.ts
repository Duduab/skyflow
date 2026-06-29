import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ElevationAssetsController } from './elevation-assets.controller.js';
import { ElevationController } from './elevation.controller.js';
import { ElevationService } from './elevation.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ElevationController, ElevationAssetsController],
  providers: [ElevationService],
  exports: [ElevationService],
})
export class ElevationModule {}
