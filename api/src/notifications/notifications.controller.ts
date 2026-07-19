import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';

type AuthedRequest = { user?: { userId?: string } };

function userIdOf(req: AuthedRequest): string {
  const id = req.user?.userId;
  if (!id) throw new BadRequestException('Missing authenticated user');
  return id;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query('limit') limit?: number) {
    return this.notifications.listForUser(userIdOf(req), limit);
  }

  @Get('unread-count')
  unread(@Req() req: AuthedRequest) {
    return this.notifications.unreadCount(userIdOf(req));
  }

  @Post(':id/read')
  markRead(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.notifications.markRead(userIdOf(req), id);
  }

  @Post('read-all')
  markAllRead(@Req() req: AuthedRequest) {
    return this.notifications.markAllRead(userIdOf(req));
  }
}
