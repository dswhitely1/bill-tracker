import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

/**
 * Every route is lazily loaded. The shell is a parent route rather than a
 * component the children each import, so `authGuard` runs once for the
 * whole signed-in area instead of being repeated — and forgotten — on
 * each child.
 *
 * Children are added by the tasks that create their screens: `/categories`
 * in task 9, `/bills` in task 10, `/upcoming` in task 11, `/settings` in
 * task 13. Until task 11 the default redirect lands on the not-found
 * screen, which is expected mid-plan.
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
      { path: '', pathMatch: 'full', redirectTo: 'upcoming' },
      {
        path: 'categories',
        loadComponent: () =>
          import('./categories/categories.component').then((m) => m.CategoriesComponent),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./shell/not-found.component').then((m) => m.NotFoundComponent),
  },
];
