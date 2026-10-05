import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PaymentLogResponse, PaymentResultResponse } from '@bill-tracker/shared-types';
import { BillInstance } from './bill-instance.entity';
import { PaymentLog } from './payment-log.entity';
import { BillInstancesService } from './bill-instances.service';
import { BillGeneratorService } from './bill-generator.service';
import { toInstanceResponse, toPaymentResponse } from './mappers';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { round2 } from '../common/money';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentLog) private readonly logs: Repository<PaymentLog>,
    private readonly instances: BillInstancesService,
    private readonly generator: BillGeneratorService,
  ) {}

  /**
   * One transaction, spec §6.1: lock the instance, validate, append the log
   * row, then recompute the cached state from the whole log. The log is the
   * truth; `amount_paid` and `status` are a cache of it.
   */
  async record(
    userId: string, instanceId: string, dto: RecordPaymentDto,
  ): Promise<PaymentResultResponse> {
    return this.logs.manager.transaction(async (manager) => {
      const { instance, bill } = await this.instances.loadOwnedLocked(
        userId, instanceId, manager,
      );

      const balance = round2(instance.amount - instance.amountPaid);
      const amount = dto.amount ?? balance;

      if (amount <= 0) {
        throw new BadRequestException(
          balance <= 0
            ? 'This bill is already paid in full'
            : 'amount must be greater than 0',
        );
      }
      if (amount > balance) {
        throw new BadRequestException(
          `amount exceeds the remaining balance of ${balance.toFixed(2)}`,
        );
      }

      const logRepo = manager.getRepository(PaymentLog);
      const log = await logRepo.save(
        logRepo.create({
          billInstanceId: instance.id,
          userId,
          amountPaid: amount,
          paidAt: dto.paidAt === undefined ? new Date() : new Date(dto.paidAt),
          note: dto.note ?? null,
          reversesPaymentId: null,
        }),
      );

      await this.instances.recompute(instance, manager);
      const saved = await manager.getRepository(BillInstance).save(instance);

      return {
        instance: toInstanceResponse(saved, bill, this.generator.today()),
        payment: toPaymentResponse(log),
      };
    });
  }

  async list(userId: string, instanceId: string): Promise<PaymentLogResponse[]> {
    // findOne enforces ownership and 404s before any log is read.
    await this.instances.findOne(userId, instanceId);
    const rows = await this.logs.find({
      where: { billInstanceId: instanceId, userId },
      order: { paidAt: 'ASC', createdAt: 'ASC' },
    });
    return rows.map(toPaymentResponse);
  }
}
