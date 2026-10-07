import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { EmptyStateComponent } from '../shared/empty-state.component';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, MatButtonModule, EmptyStateComponent],
  template: `
    <app-empty-state
      icon="explore_off"
      title="That page does not exist"
      message="The link may be out of date, or the bill it pointed to may have been deleted."
    >
      <a matButton="filled" routerLink="/dashboard">Go to Dashboard</a>
    </app-empty-state>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundComponent {}
