import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CALENDAR_DATE_FORMATS,
  CalendarDateAdapter,
  INVALID_CALENDAR_DATE,
  provideCalendarDateAdapter,
} from './calendar-date.adapter';
import { today } from './calendar-date';

let adapter: CalendarDateAdapter;

beforeEach(() => {
  adapter = new CalendarDateAdapter();
});

describe('component accessors', () => {
  it('reads the year', () => {
    expect(adapter.getYear('2026-10-06')).toBe(2026);
  });

  it('reads the month zero-based, as Material requires', () => {
    // October is 10 in a calendar date and 9 to Material. Getting this
    // backwards shifts every date by a month and nothing else fails.
    expect(adapter.getMonth('2026-10-06')).toBe(9);
    expect(adapter.getMonth('2026-01-06')).toBe(0);
    expect(adapter.getMonth('2026-12-06')).toBe(11);
  });

  it('reads the day of the month one-based', () => {
    expect(adapter.getDate('2026-10-06')).toBe(6);
    expect(adapter.getDate('2026-10-01')).toBe(1);
  });

  it('reads the day of the week with Sunday as zero', () => {
    expect(adapter.getDayOfWeek('2026-10-04')).toBe(0);
    expect(adapter.getDayOfWeek('2026-10-10')).toBe(6);
  });

  it('counts the days in the given month', () => {
    expect(adapter.getNumDaysInMonth('2026-02-10')).toBe(28);
    expect(adapter.getNumDaysInMonth('2024-02-10')).toBe(29);
    expect(adapter.getNumDaysInMonth('2026-10-10')).toBe(31);
  });

  it('names the year', () => {
    expect(adapter.getYearName('2026-10-06')).toBe('2026');
  });

  it('starts the week on Sunday', () => {
    expect(adapter.getFirstDayOfWeek()).toBe(0);
  });
});

describe('name tables', () => {
  it('returns twelve month names in each style, January first', () => {
    const first = { long: 'January', short: 'Jan', narrow: 'J' };
    const last = { long: 'December', short: 'Dec', narrow: 'D' };
    for (const style of ['long', 'short', 'narrow'] as const) {
      const names = adapter.getMonthNames(style);
      expect(names).toHaveLength(12);
      expect(names[0]).toBe(first[style]);
      expect(names[11]).toBe(last[style]);
    }
  });

  it('returns seven day names in each style, Sunday first', () => {
    const first = { long: 'Sunday', short: 'Sun', narrow: 'S' };
    for (const style of ['long', 'short', 'narrow'] as const) {
      const names = adapter.getDayOfWeekNames(style);
      expect(names).toHaveLength(7);
      expect(names[0]).toBe(first[style]);
    }
  });

  it('returns thirty-one date names, "1" first and "31" last', () => {
    const names = adapter.getDateNames();
    expect(names).toHaveLength(31);
    expect(names[0]).toBe('1');
    expect(names[30]).toBe('31');
  });
});

describe('createDate', () => {
  it('takes a zero-based month', () => {
    expect(adapter.createDate(2026, 9, 6)).toBe('2026-10-06');
    expect(adapter.createDate(2026, 0, 1)).toBe('2026-01-01');
  });

  it('builds the last day of a leap February', () => {
    expect(adapter.createDate(2024, 1, 29)).toBe('2024-02-29');
  });

  it('returns an invalid date for a day outside the month', () => {
    expect(adapter.isValid(adapter.createDate(2026, 1, 29))).toBe(false);
  });

  it('returns an invalid date for a month outside the year', () => {
    expect(adapter.isValid(adapter.createDate(2026, 12, 1))).toBe(false);
    expect(adapter.isValid(adapter.createDate(2026, -1, 1))).toBe(false);
  });
});

describe('arithmetic', () => {
  it('adds calendar days across a month boundary', () => {
    expect(adapter.addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('adds calendar months with an anchored clamp', () => {
    expect(adapter.addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(adapter.addCalendarMonths('2026-01-31', 2)).toBe('2026-03-31');
  });

  it('adds calendar years, clamping a leap day', () => {
    expect(adapter.addCalendarYears('2024-02-29', 1)).toBe('2025-02-28');
  });

  it('goes backwards', () => {
    expect(adapter.addCalendarDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(adapter.addCalendarMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('validity', () => {
  it('accepts a well-formed calendar date', () => {
    expect(adapter.isValid('2026-10-06')).toBe(true);
  });

  it('rejects the invalid sentinel', () => {
    expect(adapter.isValid(adapter.invalid())).toBe(false);
    expect(adapter.invalid()).toBe(INVALID_CALENDAR_DATE);
  });

  it('rejects a day that does not exist', () => {
    expect(adapter.isValid('2026-02-31')).toBe(false);
  });

  it('treats a well-formed string as a date instance and anything else as not', () => {
    expect(adapter.isDateInstance('2026-10-06')).toBe(true);
    expect(adapter.isDateInstance(new Date())).toBe(false);
    expect(adapter.isDateInstance(20261006)).toBe(false);
    expect(adapter.isDateInstance(null)).toBe(false);
  });
});

describe('parse', () => {
  it('parses the wire format', () => {
    expect(adapter.parse('2026-10-06', 'input')).toBe('2026-10-06');
  });

  it('parses the slash format a user is likely to type', () => {
    expect(adapter.parse('10/6/2026', 'input')).toBe('2026-10-06');
    expect(adapter.parse('10/06/2026', 'input')).toBe('2026-10-06');
  });

  it('returns null for an empty or whitespace value, so clearing a field clears it', () => {
    expect(adapter.parse('', 'input')).toBeNull();
    expect(adapter.parse('   ', 'input')).toBeNull();
    expect(adapter.parse(null, 'input')).toBeNull();
  });

  it('returns the invalid sentinel rather than null for an unparseable value', () => {
    // null means "no date"; invalid means "you typed something wrong".
    // Collapsing the two makes a typo look like an empty field, and the
    // picker silently clears itself instead of showing an error.
    expect(adapter.parse('next tuesday', 'input')).toBe(INVALID_CALENDAR_DATE);
    expect(adapter.parse('20261006', 'input')).toBe(INVALID_CALENDAR_DATE);
    expect(adapter.parse('2026-02-31', 'input')).toBe(INVALID_CALENDAR_DATE);
  });
});

describe('format', () => {
  it.each([
    ['input', '2026-10-06'],
    ['monthYear', 'Oct 2026'],
    ['monthYearA11y', 'October 2026'],
    ['dateA11y', 'Tuesday, October 6, 2026'],
    ['monthNarrow', 'O'],
  ])('formats %s as %s', (format, expected) => {
    expect(adapter.format('2026-10-06', format)).toBe(expected);
  });

  it('returns an empty string for an invalid date rather than throwing', () => {
    expect(adapter.format(INVALID_CALENDAR_DATE, 'input')).toBe('');
  });
});

describe('serialization', () => {
  it('passes a calendar date through toIso8601 unchanged, because it already is one', () => {
    expect(adapter.toIso8601('2026-10-06')).toBe('2026-10-06');
  });

  it('deserializes a wire value', () => {
    expect(adapter.deserialize('2026-10-06')).toBe('2026-10-06');
  });

  it('deserializes null, undefined, and the empty string to null', () => {
    expect(adapter.deserialize(null)).toBeNull();
    expect(adapter.deserialize(undefined)).toBeNull();
    expect(adapter.deserialize('')).toBeNull();
  });

  it('deserializes a malformed value to the invalid sentinel', () => {
    expect(adapter.deserialize('20261006')).toBe(INVALID_CALENDAR_DATE);
  });
});

describe('clone and today', () => {
  it('clones to an equal value, since strings are already immutable', () => {
    expect(adapter.clone('2026-10-06')).toBe('2026-10-06');
  });

  it('agrees with the module own today()', () => {
    expect(adapter.today()).toBe(today());
  });
});

describe('inherited behaviour built on the overrides', () => {
  it('compares dates', () => {
    expect(adapter.compareDate('2026-01-01', '2026-01-02')).toBeLessThan(0);
    expect(adapter.compareDate('2026-01-02', '2026-01-01')).toBeGreaterThan(0);
    expect(adapter.compareDate('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('reports equal dates as the same', () => {
    expect(adapter.sameDate('2026-01-01', '2026-01-01')).toBe(true);
    expect(adapter.sameDate('2026-01-01', '2026-01-02')).toBe(false);
    expect(adapter.sameDate(null, null)).toBe(true);
  });

  it('clamps between a minimum and a maximum', () => {
    expect(adapter.clampDate('2025-06-01', '2026-01-01', '2026-12-31')).toBe('2026-01-01');
    expect(adapter.clampDate('2027-06-01', '2026-01-01', '2026-12-31')).toBe('2026-12-31');
    expect(adapter.clampDate('2026-06-01', '2026-01-01', '2026-12-31')).toBe('2026-06-01');
  });
});

describe('CALENDAR_DATE_FORMATS', () => {
  it('names a format token for every slot the datepicker reads', () => {
    expect(CALENDAR_DATE_FORMATS.parse.dateInput).toBe('input');
    expect(CALENDAR_DATE_FORMATS.display.dateInput).toBe('input');
    expect(CALENDAR_DATE_FORMATS.display.monthLabel).toBe('monthNarrow');
    expect(CALENDAR_DATE_FORMATS.display.monthYearLabel).toBe('monthYear');
    expect(CALENDAR_DATE_FORMATS.display.dateA11yLabel).toBe('dateA11y');
    expect(CALENDAR_DATE_FORMATS.display.monthYearA11yLabel).toBe('monthYearA11y');
  });

  it('uses only tokens that the format method understands', () => {
    const tokens = [
      CALENDAR_DATE_FORMATS.parse.dateInput,
      ...Object.values(CALENDAR_DATE_FORMATS.display),
    ];
    for (const token of tokens) {
      expect(adapter.format('2026-10-06', token)).not.toBe('');
    }
  });
});

@Component({
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatDatepickerModule],
  template: `
    <mat-form-field>
      <input matInput [matDatepicker]="picker" [formControl]="control" />
      <mat-datepicker #picker />
    </mat-form-field>
  `,
})
class DatepickerHost {
  readonly control = new FormControl<string | null>(null);
}

describe('the datepicker driven by the adapter', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DatepickerHost],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        ...provideCalendarDateAdapter(),
      ],
    });
  });

  it('writes a bare YYYY-MM-DD string into the input, with no Date anywhere', async () => {
    const fixture = TestBed.createComponent(DatepickerHost);
    fixture.componentInstance.control.setValue('2026-10-06');
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('2026-10-06');
  });

  it('reads a typed value back as a calendar date string', async () => {
    const fixture = TestBed.createComponent(DatepickerHost);
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = '10/6/2026';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.control.value).toBe('2026-10-06');
    expect(fixture.componentInstance.control.value).not.toBeInstanceOf(Date);
  });
});
