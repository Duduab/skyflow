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

  readonly isStationManager = computed(
    () => this.sessionUser()?.role === 'STATION_MANAGER',
  );

  isManagerOfStation(stationId: number): boolean {
    const u = this.sessionUser();
    return (
      u?.role === 'STATION_MANAGER' && u.managedStationId === stationId
    );
  }

  readonly isSiteManager = computed(
    () => this.sessionUser()?.role === 'SITE_MANAGER',
  );

  readonly isAdmin = computed(
    () => this.sessionUser()?.role === 'ADMIN',
  );

  /** תפקיד תכנון תפ״י — העלאת Excel ואישור למסורים */
  readonly isPlanningRole = computed(
    () => this.sessionUser()?.role === 'PLANNING',
  );

  /** עובד / מנהל עמדה / מנהל אתר — בלי גישה ללוח ניהול */
  readonly isFloorStaffRole = computed(() => {
    const r = this.sessionUser()?.role;
    return (
      r === 'WORKER' || r === 'STATION_MANAGER' || r === 'SITE_MANAGER'
    );
  });

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
