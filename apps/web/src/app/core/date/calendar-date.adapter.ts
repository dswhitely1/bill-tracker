import { Injectable, Provider } from '@angular/core';
import { DateAdapter, MAT_DATE_FORMATS, MatDateFormats } from '@angular/material/core';
import {
  CalendarDate,
  DAY_NAMES_LONG,
  DAY_NAMES_NARROW,
  DAY_NAMES_SHORT,
  MONTH_NAMES_LONG,
  MONTH_NAMES_NARROW,
  MONTH_NAMES_SHORT,
  addDays,
  addMonths,
  addYears,
  dayOfWeek,
  daysInMonth,
  fromParts,
  isCalendarDate,
  parts,
  today,
} from './calendar-date';

/**
 * The value `invalid()` returns. Deliberately not a well-formed date, so
 * `isCalendarDate` rejects it and it can never be mistaken for a real day.
 */
export const INVALID_CALENDAR_DATE: CalendarDate = 'invalid';

const SLASH_FORMAT = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Adapts Angular Material's datepicker to `YYYY-MM-DD` strings.
 *
 * The alternative — `NativeDateAdapter` plus conversion at the form
 * boundary — means a `Date` exists somewhere in the flow, and every such
 * `Date` is a chance to render a due date as the previous day. Adapting the
 * picker itself means no `Date` is ever constructed from a stored value at
 * all.
 *
 * **Material's month is zero-based and a calendar date's is one-based.**
 * Every conversion between the two happens here and nowhere else.
 */
@Injectable()
export class CalendarDateAdapter extends DateAdapter<CalendarDate> {
  getYear(date: CalendarDate): number {
    return parts(date).year;
  }

  getMonth(date: CalendarDate): number {
    return parts(date).month - 1;
  }

  getDate(date: CalendarDate): number {
    return parts(date).day;
  }

  getDayOfWeek(date: CalendarDate): number {
    return dayOfWeek(date);
  }

  getMonthNames(style: 'long' | 'short' | 'narrow'): string[] {
    const table = { long: MONTH_NAMES_LONG, short: MONTH_NAMES_SHORT, narrow: MONTH_NAMES_NARROW };
    return [...table[style]];
  }

  getDateNames(): string[] {
    return Array.from({ length: 31 }, (_, index) => String(index + 1));
  }

  getDayOfWeekNames(style: 'long' | 'short' | 'narrow'): string[] {
    const table = { long: DAY_NAMES_LONG, short: DAY_NAMES_SHORT, narrow: DAY_NAMES_NARROW };
    return [...table[style]];
  }

  getYearName(date: CalendarDate): string {
    return String(parts(date).year);
  }

  getFirstDayOfWeek(): number {
    return 0;
  }

  getNumDaysInMonth(date: CalendarDate): number {
    const { year, month } = parts(date);
    return daysInMonth(year, month);
  }

  clone(date: CalendarDate): CalendarDate {
    return date;
  }

  /** `month` is zero-based, per Material's contract. */
  createDate(year: number, month: number, date: number): CalendarDate {
    if (month < 0 || month > 11) return this.invalid();
    if (date < 1 || date > daysInMonth(year, month + 1)) return this.invalid();
    return fromParts(year, month + 1, date);
  }

  today(): CalendarDate {
    return today();
  }

  /**
   * `null` means "there is no date here"; the invalid sentinel means "you
   * typed something that is not one". Collapsing them would make a typo
   * look like an empty field, and the picker would clear itself instead of
   * reporting an error.
   */
  parse(value: unknown, _parseFormat: unknown): CalendarDate | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (text === '') return null;

    if (isCalendarDate(text)) return text;

    const slash = SLASH_FORMAT.exec(text);
    if (slash) {
      const month = Number(slash[1]);
      const day = Number(slash[2]);
      const year = Number(slash[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)) {
        return fromParts(year, month, day);
      }
    }

    return this.invalid();
  }

  format(date: CalendarDate, displayFormat: unknown): string {
    if (!this.isValid(date)) return '';
    const { year, month, day } = parts(date);

    switch (displayFormat) {
      case 'monthNarrow':
        return MONTH_NAMES_NARROW[month - 1];
      case 'monthYear':
        return `${MONTH_NAMES_SHORT[month - 1]} ${year}`;
      case 'monthYearA11y':
        return `${MONTH_NAMES_LONG[month - 1]} ${year}`;
      case 'dateA11y':
        return `${DAY_NAMES_LONG[dayOfWeek(date)]}, ${MONTH_NAMES_LONG[month - 1]} ${day}, ${year}`;
      default:
        return date;
    }
  }

  addCalendarYears(date: CalendarDate, years: number): CalendarDate {
    return addYears(date, years);
  }

  addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
    return addMonths(date, months);
  }

  addCalendarDays(date: CalendarDate, days: number): CalendarDate {
    return addDays(date, days);
  }

  /** A calendar date already is an ISO 8601 date. */
  toIso8601(date: CalendarDate): string {
    return date;
  }

  isDateInstance(obj: unknown): boolean {
    return typeof obj === 'string' && isCalendarDate(obj);
  }

  isValid(date: CalendarDate): boolean {
    return isCalendarDate(date);
  }

  invalid(): CalendarDate {
    return INVALID_CALENDAR_DATE;
  }

  override deserialize(value: unknown): CalendarDate | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    if (typeof value === 'string' && isCalendarDate(value)) return value;
    return this.invalid();
  }
}

export const CALENDAR_DATE_FORMATS: MatDateFormats = {
  parse: { dateInput: 'input' },
  display: {
    dateInput: 'input',
    monthLabel: 'monthNarrow',
    monthYearLabel: 'monthYear',
    dateA11yLabel: 'dateA11y',
    monthYearA11yLabel: 'monthYearA11y',
  },
};

export function provideCalendarDateAdapter(): Provider[] {
  return [
    { provide: DateAdapter, useClass: CalendarDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: CALENDAR_DATE_FORMATS },
  ];
}
