import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { DailyTargetPlanningService } from './daily-target-planning.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService, DailyTargetPlanningService],
  exports: [UsersService, DailyTargetPlanningService],
})
export class UsersModule {}
