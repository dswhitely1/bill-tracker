import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

/**
 * Every route is lazily loaded. The shell is a parent route rather than a
 * component the children each import, so `authGuard` runs once for the
 * whole signed-in area instead of being repeated — and forgotten — on
 * each child.
 *
 * `/dashboard` is the landing screen: a tracker's first question is "what
 * do I owe", and every figure there links into the list that answers it.
 */
export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'calendar',
        loadComponent: () =>
          import('./calendar/calendar.component').then((m) => m.CalendarComponent),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./notifications/notifications.component').then(
            (m) => m.NotificationsComponent,
          ),
      },
      {
        path: 'upcoming',
        loadComponent: () =>
          import('./instances/upcoming.component').then((m) => m.UpcomingComponent),
      },
      {
        path: 'bills',
        loadComponent: () => import('./bills/bills.component').then((m) => m.BillsComponent),
      },
      {
        path: 'bills/new',
        loadComponent: () =>
          import('./bills/bill-form.component').then((m) => m.BillFormComponent),
      },
      {
        path: 'bills/:id',
        loadComponent: () =>
          import('./bills/bill-form.component').then((m) => m.BillFormComponent),
      },
      {
        path: 'categories',
        loadComponent: () =>
          import('./categories/categories.component').then((m) => m.CategoriesComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./settings/settings.component').then((m) => m.SettingsComponent),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./shell/not-found.component').then((m) => m.NotFoundComponent),
  },
];
