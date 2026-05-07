import { Injectable, computed, signal } from '@angular/core';

import { UserDto } from './skyflow.models';

const SESSION_KEY = 'skyflow-session';

@Injectable({ providedIn: 'root' })
export class CurrentUserService {
  readonly accessToken = signal<string | null>(null);
  readonly sessionUser = signal<UserDto | null>(null);

  constructor() {
    this.loadSession();
  }

  readonly firstName = computed(
    () => this.sessionUser()?.firstName?.trim() || 'אורח',
  );
  readonly lastName = computed(() => this.sessionUser()?.lastName?.trim() ?? '');
  readonly photoUrl = computed(() => this.sessionUser()?.photoUrl ?? null);

  readonly isAdmin = computed(
    () => this.sessionUser()?.role === 'ADMIN',
  );

  readonly displayName = computed(() => {
    const u = this.sessionUser();
    if (!u) return '';
    const name = `${u.firstName} ${u.lastName}`.trim();
    return name || u.email;
  });

  readonly initials = computed(() => {
    const parts = this.displayName().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? '?';
    const b = parts[1]?.[0] ?? '';
    return (a + b).toUpperCase();
  });

  setSession(accessToken: string, user: UserDto): void {
    this.accessToken.set(accessToken);
    this.sessionUser.set(user);
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ accessToken, user }),
      );
    } catch {
      /* ignore */
    }
  }

  logout(): void {
    this.accessToken.set(null);
    this.sessionUser.set(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  saveLocalProfile(patch: {
    firstName?: string;
    lastName?: string;
    photoUrl?: string | null;
  }): void {
    const u = this.sessionUser();
    if (!u) return;
    const next: UserDto = {
      ...u,
      ...patch,
      photoUrl:
        patch.photoUrl !== undefined ? patch.photoUrl : u.photoUrl,
    };
    this.sessionUser.set(next);
    const token = this.accessToken();
    if (token) {
      try {
        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({ accessToken: token, user: next }),
        );
      } catch {
        /* ignore */
      }
    }
  }

  private loadSession(): void {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as {
        accessToken?: string;
        user?: UserDto;
      };
      if (j.accessToken && j.user) {
        this.accessToken.set(j.accessToken);
        this.sessionUser.set(j.user);
      }
    } catch {
      /* ignore */
    }
  }
}
