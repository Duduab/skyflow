import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkCycleService } from './work-cycle.service';
import { WorkCycleController } from './work-cycle.controller';

@Module({
  imports: [AuthModule],
  controllers: [WorkCycleController],
  providers: [WorkCycleService],
  exports: [WorkCycleService],
})
export class WorkCyclesModule {}
