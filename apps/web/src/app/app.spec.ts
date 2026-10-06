import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { describe, expect, it } from 'vitest';
import { BILL_FREQUENCIES } from '@bill-tracker/shared-types';
import { App } from './app';

describe('App', () => {
  it('renders one Material chip per bill frequency, proving the shared library resolves at runtime', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideAnimationsAsync('noop'),
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const chips = fixture.nativeElement.querySelectorAll('mat-chip');
    expect(chips).toHaveLength(BILL_FREQUENCIES.length);
    expect(chips[0].textContent?.trim()).toBe('ONE_TIME');
  });

  it('types a value against the error contract added in task 1', () => {
    // A compile-time assertion with a runtime witness: if the contract is
    // not exported, this file does not build.
    const body: import('@bill-tracker/shared-types').ValidationErrorResponse = {
      statusCode: 400,
      error: 'Bad Request',
      message: ['name should not be empty'],
      errors: { name: ['name should not be empty'] },
      path: '/api/bills',
      timestamp: '2026-10-06T00:00:00.000Z',
    };

    expect(body.errors['name']).toHaveLength(1);
  });
});
