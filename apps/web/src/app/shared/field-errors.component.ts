import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';

/**
 * Renders the one message a person needs for a control.
 *
 * The server's message wins over a client one: the server knows things the
 * client does not, and showing "is required" instead of "that name is
 * already taken" hides the real answer.
 *
 * An unrecognised validator still produces a sentence. A form that will
 * not submit and shows no reason is the worst outcome this component can
 * produce, so there is no path through it that renders nothing for an
 * invalid, touched control.
 */
@Component({
  selector: 'app-field-errors',
  imports: [MatFormFieldModule],
  template: `
    @if (message(); as text) {
      <mat-error>{{ text }}</mat-error>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldErrorsComponent {
  readonly control = input.required<AbstractControl>();
  readonly label = input('This field');

  message(): string | null {
    const control = this.control();
    if (!control.touched || control.errors === null) return null;

    const errors = control.errors;
    const name = this.label();

    if (typeof errors['server'] === 'string') return errors['server'];
    if (errors['required']) return `${name} is required`;
    if (errors['email']) return `${name} must be a valid email address`;
    if (errors['minlength']) {
      return `${name} must be at least ${errors['minlength'].requiredLength} characters`;
    }
    if (errors['maxlength']) {
      return `${name} must be at most ${errors['maxlength'].requiredLength} characters`;
    }
    if (errors['min']) return `${name} must be at least ${errors['min'].min}`;
    if (errors['max']) return `${name} must be at most ${errors['max'].max}`;
    if (errors['matDatepickerParse']) return `${name} must be a date, as YYYY-MM-DD`;

    return `${name} is not valid`;
  }
}
