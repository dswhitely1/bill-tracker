import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { SessionService } from '../core/auth/session.service';
import { NotificationBellComponent } from './notification-bell.component';

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatSidenavModule,
    MatToolbarModule,
    NotificationBellComponent,
  ],
  template: `
    <mat-toolbar>
      <span class="brand">Bill Tracker</span>
      <span class="spacer"></span>
      <span class="user">{{ user()?.name }}</span>
      <app-notification-bell />
      <button matIconButton data-testid="sign-out" aria-label="Sign out" (click)="signOut()">
        <mat-icon>logout</mat-icon>
      </button>
    </mat-toolbar>

    <mat-sidenav-container>
      <mat-sidenav mode="side" opened>
        <mat-nav-list>
          <a mat-list-item routerLink="/dashboard" routerLinkActive="active">
            <mat-icon matListItemIcon>dashboard</mat-icon>
            <span matListItemTitle>Dashboard</span>
          </a>
          <a mat-list-item routerLink="/calendar" routerLinkActive="active">
            <mat-icon matListItemIcon>calendar_month</mat-icon>
            <span matListItemTitle>Calendar</span>
          </a>
          <a mat-list-item routerLink="/upcoming" routerLinkActive="active">
            <mat-icon matListItemIcon>event</mat-icon>
            <span matListItemTitle>Upcoming</span>
          </a>
          <a mat-list-item routerLink="/bills" routerLinkActive="active">
            <mat-icon matListItemIcon>receipt_long</mat-icon>
            <span matListItemTitle>Bills</span>
          </a>
          <a mat-list-item routerLink="/categories" routerLinkActive="active">
            <mat-icon matListItemIcon>label</mat-icon>
            <span matListItemTitle>Categories</span>
          </a>
          <a mat-list-item routerLink="/settings" routerLinkActive="active">
            <mat-icon matListItemIcon>settings</mat-icon>
            <span matListItemTitle>Settings</span>
          </a>
        </mat-nav-list>
      </mat-sidenav>

      <mat-sidenav-content>
        <router-outlet />
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100dvh;
    }
    .spacer {
      flex: 1;
    }
    .user {
      margin-right: 0.5rem;
    }
    mat-sidenav-container {
      flex: 1;
    }
    mat-sidenav {
      width: 15rem;
    }
    mat-sidenav-content {
      padding: 1.5rem;
    }
    @media (max-width: 48rem) {
      mat-sidenav {
        width: 4rem;
      }
      mat-sidenav span[matListItemTitle] {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  readonly user = this.session.user;

  async signOut(): Promise<void> {
    await this.session.signOut();
    void this.router.navigateByUrl('/login');
  }
}
