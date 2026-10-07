import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SummaryService } from './summary.service';

@Controller('summary')
export class SummaryController {
  constructor(private readonly summary: SummaryService) {}

  /**
   * No query parameters. The figures are defined relative to the server's
   * own day (spec §3.2); letting a client pass one in would let it ask a
   * question the overdue badge on /api/bill-instances cannot be asked, and
   * the two would start disagreeing.
   */
  @Get()
  get(@CurrentUser() userId: string) {
    return this.summary.get(userId);
  }
}
