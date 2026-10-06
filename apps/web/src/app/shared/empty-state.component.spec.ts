import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { EmptyStateComponent } from './empty-state.component';

@Component({
  imports: [EmptyStateComponent],
  template: `
    <app-empty-state icon="label" title="No categories yet" message="Create one to start.">
      <button>Create category</button>
    </app-empty-state>
  `,
})
class Host {}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [provideZonelessChangeDetection()],
  });
});

describe('EmptyStateComponent', () => {
  it('renders the icon, title and message inputs', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(fixture.nativeElement.querySelector('mat-icon').textContent).toContain('label');
    expect(text).toContain('No categories yet');
    expect(text).toContain('Create one to start.');
  });

  it('renders projected content', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Create category');
  });
});
