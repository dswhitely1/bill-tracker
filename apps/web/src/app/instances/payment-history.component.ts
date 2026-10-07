import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { PaymentLogResponse } from '@bill-tracker/shared-types';
import { errorMessage } from '../core/api/api-error';
import { PaymentsService } from '../core/state/payments.service';
import { formatMoney } from '../shared/money';

@Component({
  selector: 'app-payment-history',
  imports: [MatButtonModule, MatIconModule, MatListModule, MatProgressBarModule],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (entries().length === 0 && !loading()) {
      <p class="muted">No payments recorded yet.</p>
    } @else {
      <mat-list>
        @for (entry of entries(); track entry.id) {
          <mat-list-item data-testid="payment-entry">
            <span matListItemTitle>
              {{ money(entry.amountPaid) }}
              @if (entry.reversesPaymentId) {
                <span class="tag">Reversal</span>
              }
            </span>
            <span matListItemLine>{{ timestamp(entry.paidAt) }}{{ entry.note ? ' — ' + entry.note : '' }}</span>
            <span matListItemMeta>
              @if (!entry.reversesPaymentId) {
                <button
                  matIconButton
                  data-testid="reverse"
                  aria-label="Reverse this payment"
                  (click)="reverse(entry)"
                >
                  <mat-icon>undo</mat-icon>
                </button>
              }
            </span>
          </mat-list-item>
        }
      </mat-list>
    }
  `,
  styles: `
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      color: var(--mat-sys-error);
    }
    .tag {
      margin-left: 0.5rem;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentHistoryComponent {
  private readonly payments = inject(PaymentsService);

  readonly instanceId = input.required<string>();

  readonly entries = signal<PaymentLogResponse[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.payments.mutations();
      const id = this.instanceId();
      void this.load(id);
    });
  }

  /**
   * The log is append-only, so a reversal is rendered as its own negative
   * row beside the payment it undid. Netting the two to zero and showing
   * nothing would throw away the fact that something happened and was
   * corrected — which is the entire reason the log works this way.
   */
  protected money(amount: number): string {
    return amount < 0 ? `-${formatMoney(Math.abs(amount))}` : formatMoney(amount);
  }

  /** An ISO 8601 instant, not a calendar day — `Date` is correct here. */
  protected timestamp(value: string): string {
    return new Date(value).toLocaleString();
  }

  async reverse(entry: PaymentLogResponse): Promise<void> {
    this.error.set(null);
    try {
      // No explicit reload here: a successful reverse bumps
      // `payments.mutations()`, and the constructor's effect re-fetches in
      // response. Reloading here too would double-fetch.
      await this.payments.reverse(this.instanceId(), entry.id);
    } catch (error: unknown) {
      this.error.set(errorMessage(error));
      // A conflict means the local view and the server disagree. Showing
      // the error beside a stale list is worse than either alone, so both
      // the instance and the log are re-read. `load()` already guards its
      // own failure; `reload()` does not, and this handler runs from a
      // template click with nothing further to catch a rejection, so a
      // failure here is caught and folded into the same error signal
      // rather than escaping as an unhandled rejection.
      try {
        await this.payments.reload(this.instanceId());
      } catch (reloadError: unknown) {
        this.error.set(errorMessage(reloadError));
      }
      await this.load(this.instanceId());
    }
  }

  async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      this.entries.set(await this.payments.history(id));
    } catch (error: unknown) {
      this.error.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
