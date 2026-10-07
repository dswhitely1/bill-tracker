import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';
import { FieldErrorsComponent } from './field-errors.component';
import { MAX_AMOUNT, MIN_AMOUNT, amountValidators } from './money';

@Component({
  imports: [ReactiveFormsModule, FieldErrorsComponent],
  template: `<app-field-errors [control]="control()" [label]="label()" />`,
})
class Host {
  readonly control = signal<FormControl>(new FormControl('', [Validators.required]));
  readonly label = signal('Name');
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [provideZonelessChangeDetection()],
  });
});

describe('FieldErrorsComponent', () => {
  it('shows nothing while the control is untouched', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('names the field in a required message', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.control().markAsTouched();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Name is required');
  });

  it('prefers the server message over a client one', async () => {
    // The server knows something the client does not; showing "is
    // required" over "that name is already taken" hides the real answer.
    const fixture = TestBed.createComponent(Host);
    const control = fixture.componentInstance.control();
    control.setErrors({ required: true, server: 'That name is already taken' });
    control.markAsTouched();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('That name is already taken');
    expect(fixture.nativeElement.textContent).not.toContain('is required');
  });

  it('reports a minimum and a maximum in money terms', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.control.set(new FormControl(0, amountValidators));
    fixture.componentInstance.label.set('Amount');
    fixture.componentInstance.control().markAsTouched();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(String(MIN_AMOUNT));

    fixture.componentInstance.control.set(new FormControl(MAX_AMOUNT + 1, amountValidators));
    fixture.componentInstance.control().markAsTouched();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(String(MAX_AMOUNT));
  });

  it('shows a message when the control is touched after the first render', async () => {
    // Regression: the component is OnPush and reads control.touched/errors
    // directly, neither of which is a signal. Marking touched *after* the
    // initial settle must still schedule a re-render.
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim()).toBe('');

    fixture.componentInstance.control().markAllAsTouched();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Name is required');
  });

  it('shows a server error attached after the first render', async () => {
    // Regression: a server error applied to an already-rendered control
    // (the applyServerErrors path) must also trigger a re-render.
    const fixture = TestBed.createComponent(Host);
    const control = fixture.componentInstance.control();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim()).toBe('');

    control.setErrors({ server: 'That name is already taken' });
    control.markAsTouched();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('That name is already taken');
  });

  it('falls back to a generic sentence for a validator it does not know', async () => {
    const fixture = TestBed.createComponent(Host);
    const control = fixture.componentInstance.control();
    control.setErrors({ someCustomRule: true });
    control.markAsTouched();
    await fixture.whenStable();

    // Never render nothing when a control is invalid: an un-submittable
    // form with no visible reason is the worst outcome here.
    expect(fixture.nativeElement.textContent.trim()).not.toBe('');
  });
});
