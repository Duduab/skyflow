import { Injectable, computed, signal } from '@angular/core';

/**
 * Placeholder until auth provides the signed-in user.
 */
@Injectable({ providedIn: 'root' })
export class CurrentUserService {
  readonly firstName = signal('יוסי');
  readonly lastName = signal('לוי');
  /** When null, UI shows initials avatar */
  readonly photoUrl = signal<string | null>(null);

  readonly displayName = computed(
    () => `${this.firstName()} ${this.lastName()}`.trim(),
  );

  readonly initials = computed(() => {
    const parts = this.displayName().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? '?';
    const b = parts[1]?.[0] ?? '';
    return (a + b).toUpperCase();
  });
}
