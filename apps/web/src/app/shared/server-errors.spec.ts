import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormGroup } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyServerErrors } from './server-errors';

let form: FormGroup;

beforeEach(() => {
  const fb = new FormBuilder();
  form = fb.group({ name: [''], defaultAmount: [0] });
});

function badRequest(body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status: 400, error: body, url: '/api/bills' });
}

describe('applyServerErrors', () => {
  it('attaches a message to the control that produced it', () => {
    const unmatched = applyServerErrors(
      form,
      badRequest({
        statusCode: 400,
        error: 'Bad Request',
        message: ['name should not be empty'],
        errors: { name: ['name should not be empty'] },
        path: '/api/bills',
        timestamp: '2026-10-06T00:00:00.000Z',
      }),
    );

    expect(form.controls['name'].errors).toMatchObject({ server: 'name should not be empty' });
    expect(unmatched).toEqual([]);
  });

  it('marks the control touched, so the message is actually displayed', () => {
    applyServerErrors(
      form,
      badRequest({ message: ['name should not be empty'], errors: { name: ['x'] } }),
    );

    expect(form.controls['name'].touched).toBe(true);
  });

  it('attaches messages to several controls at once', () => {
    applyServerErrors(
      form,
      badRequest({
        message: ['a', 'b'],
        errors: { name: ['name is required'], defaultAmount: ['amount must be positive'] },
      }),
    );

    expect(form.controls['name'].errors).toMatchObject({ server: 'name is required' });
    expect(form.controls['defaultAmount'].errors).toMatchObject({
      server: 'amount must be positive',
    });
  });

  it('returns a message whose field matches no control instead of dropping it', () => {
    // The failure mode this guards: a form rejects a submission and shows
    // nothing at all, because the only message belonged to a field the
    // form does not render.
    const unmatched = applyServerErrors(
      form,
      badRequest({ message: ['x'], errors: { frequency: ['frequency must be one of...'] } }),
    );

    expect(unmatched).toEqual(['frequency must be one of...']);
  });

  it('returns every message of an unmatched field, not just the first', () => {
    const unmatched = applyServerErrors(
      form,
      badRequest({ message: ['x', 'y'], errors: { frequency: ['first', 'second'] } }),
    );

    expect(unmatched).toEqual(['first', 'second']);
  });

  it('returns the single message of a 400 that carries no field map', () => {
    // A service-raised 400 — a categoryId naming another user's category.
    // There is nothing to attach, and the message must still be seen.
    const unmatched = applyServerErrors(
      form,
      badRequest({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Category not found',
        path: '/api/bills',
        timestamp: '2026-10-06T00:00:00.000Z',
      }),
    );

    expect(unmatched).toEqual(['Category not found']);
    expect(form.controls['name'].errors).toBeNull();
  });

  it('returns a readable message for a 409', () => {
    const unmatched = applyServerErrors(
      form,
      new HttpErrorResponse({ status: 409, error: { message: 'Already exists' } }),
    );

    expect(unmatched).toEqual(['Already exists']);
  });

  it('keeps the own validation errors of a control alongside those from the server', () => {
    form.controls['name'].setErrors({ required: true });
    applyServerErrors(form, badRequest({ message: ['x'], errors: { name: ['too short'] } }));

    expect(form.controls['name'].errors).toMatchObject({ required: true, server: 'too short' });
  });
});
