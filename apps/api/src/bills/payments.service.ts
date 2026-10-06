import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  BillInstanceResponse, PaymentLogResponse, PaymentResultResponse,
} from '@bill-tracker/shared-types';
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

  /**
   * Appends the exact negation of a payment — spec §6.3. Nothing is ever
   * deleted or mutated: `payment_logs` is append-only, so "I mis-clicked"
   * stays visible instead of being erased.
   */
  async reverse(
    userId: string, instanceId: string, paymentId: string,
  ): Promise<PaymentResultResponse> {
    return this.logs.manager.transaction(async (manager) => {
      const { instance, bill } = await this.instances.loadOwnedLocked(
        userId, instanceId, manager,
      );
      const logRepo = manager.getRepository(PaymentLog);

      // Scoped to this instance and this user, so someone else's payment is
      // indistinguishable from one that does not exist.
      const target = await logRepo.findOne({
        where: { id: paymentId, billInstanceId: instance.id, userId },
      });
      if (!target) throw new NotFoundException('Payment not found');

      if (target.reversesPaymentId !== null) {
        throw new ConflictException(
          'A reversal cannot itself be reversed — record a new payment instead',
        );
      }
      const already = await logRepo.findOne({ where: { reversesPaymentId: target.id } });
      if (already) throw new ConflictException('That payment has already been reversed');

      const reversal = await logRepo.save(
        logRepo.create({
          billInstanceId: instance.id,
          userId,
          amountPaid: -target.amountPaid,
          paidAt: new Date(),
          note: null,
          reversesPaymentId: target.id,
        }),
      );

      await this.instances.recompute(instance, manager);
      const saved = await manager.getRepository(BillInstance).save(instance);

      return {
        instance: toInstanceResponse(saved, bill, this.generator.today()),
        payment: toPaymentResponse(reversal),
      };
    });
  }

  /**
   * The misclick button: reverses every unreversed payment at once. Sugar
   * over the same primitive, not a second mechanism.
   */
  async unpay(userId: string, instanceId: string): Promise<BillInstanceResponse> {
    return this.logs.manager.transaction(async (manager) => {
      const { instance, bill } = await this.instances.loadOwnedLocked(
        userId, instanceId, manager,
      );
      const logRepo = manager.getRepository(PaymentLog);

      const outstanding: Array<{ id: string; amount_paid: string }> = await manager.query(
        `SELECT p."id", p."amount_paid"
           FROM "payment_logs" p
          WHERE p."bill_instance_id" = $1
            AND p."reverses_payment_id" IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM "payment_logs" r WHERE r."reverses_payment_id" = p."id")`,
        [instance.id],
      );
      if (outstanding.length === 0) {
        throw new ConflictException('This bill instance has no payments to reverse');
      }

      const now = new Date();
      await logRepo.save(
        outstanding.map((row) =>
          logRepo.create({
            billInstanceId: instance.id,
            userId,
            amountPaid: -Number(row.amount_paid),
            paidAt: now,
            note: null,
            reversesPaymentId: row.id,
          }),
        ),
      );

      await this.instances.recompute(instance, manager);
      const saved = await manager.getRepository(BillInstance).save(instance);
      return toInstanceResponse(saved, bill, this.generator.today());
    });
  }
}
