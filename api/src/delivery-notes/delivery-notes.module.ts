import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { DeliveryNotesService } from './delivery-notes.service.js';

@Module({
  imports: [OrdersModule, MailModule],
  providers: [DeliveryNotesService],
  exports: [DeliveryNotesService],
})
export class DeliveryNotesModule {}
