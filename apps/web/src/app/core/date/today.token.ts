import { InjectionToken } from '@angular/core';
import { CalendarDate, today } from './calendar-date';

/**
 * How a component asks what day it is in the browser's own time zone.
 *
 * A token rather than a direct `today()` call so a test can pin the day
 * without stubbing a module export — `vi.spyOn` on an ES module namespace
 * is not dependable under Vite's transform. This mirrors the choice
 * `UpcomingComponent.refreshIfDayChanged(now = today())` already makes by
 * taking the day as a parameter.
 *
 * This is never the source of overdue state. That is derived server-side
 * against `APP_TIMEZONE` and arrives on the instance as `isOverdue`.
 */
export const TODAY = new InjectionToken<() => CalendarDate>('TODAY', {
  providedIn: 'root',
  factory: () => today,
});
