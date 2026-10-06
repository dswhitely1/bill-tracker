import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatChipsModule } from '@angular/material/chips';
import { BILL_FREQUENCIES } from '@bill-tracker/shared-types';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MatChipsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  /**
   * Temporary scaffolding, replaced by the shell in task 7. It exists so
   * that one commit proves the three things most likely to go wrong later:
   * that the bundler resolves `@bill-tracker/shared-types` through its
   * `nodenext` exports map, that Material renders without zone.js, and
   * that `nx test web` runs at all.
   */
  protected readonly frequencies = signal([...BILL_FREQUENCIES]);
}
