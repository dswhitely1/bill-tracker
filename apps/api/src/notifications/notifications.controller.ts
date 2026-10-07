import {
  Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.notifications.list(userId);
  }

  /**
   * `read-all` is declared before `:id/read` only for readability — the
   * two patterns cannot collide, since one has a second segment. Marking
   * read is also the dismiss action: there is no DELETE, because removing
   * the row would remove what UQ_notifications_instance_kind relies on and
   * the next run would recreate the reminder.
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(userId, id);
  }
}
