import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DeliveryNotesModule } from '../delivery-notes/delivery-notes.module.js';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, DeliveryNotesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
