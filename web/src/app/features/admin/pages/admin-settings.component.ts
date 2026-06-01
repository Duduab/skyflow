import { HttpClient } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { take } from 'rxjs/operators';

import { CurrentUserService } from '../../../core/current-user.service';
import { LanguageService, SkyflowLang } from '../../../core/language.service';
import { ThemeService, SkyflowTheme } from '../../../core/theme.service';
import { SkyflowRole } from '../../../core/skyflow.models';
import { UiButtonComponent } from '../../../shared/ui-button.component';

const SIM_STORAGE_KEY = 'skyflow-order-simulations-v1';

@Component({
  selector: 'skyflow-admin-settings',
  imports: [TranslateModule, FormsModule, UiButtonComponent],
  templateUrl: './admin-settings.component.html',
  styleUrl: './admin-settings.component.scss',
})
export class AdminSettingsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly user = inject(CurrentUserService);
  readonly lang = inject(LanguageService);
  readonly theme = inject(ThemeService);

  draftFirst = '';
  draftLast = '';
  draftPhoto = '';
  avatarBroken = false;

  readonly profileSaved = signal(false);
  readonly healthStatus = signal<'unknown' | 'ok' | 'error'>('unknown');
  readonly healthMs = signal<number | null>(null);
  readonly healthChecking = signal(false);

  readonly languages: { code: SkyflowLang; labelKey: string; glyph: string }[] =
    [
      { code: 'he', labelKey: 'LANG.HE', glyph: 'עב' },
      { code: 'ar', labelKey: 'LANG.AR', glyph: 'عر' },
      { code: 'en', labelKey: 'LANG.EN', glyph: 'EN' },
    ];

  ngOnInit(): void {
    this.syncDraftFromUser();
    this.checkHealth();
  }

  syncDraftFromUser(): void {
    this.draftFirst = this.user.firstName();
    this.draftLast = this.user.lastName();
    this.draftPhoto = this.user.photoUrl() ?? '';
    this.avatarBroken = false;
  }

  sessionEmail(): string {
    return this.user.sessionUser()?.email ?? '—';
  }

  roleLabelKey(): string {
    const role = this.user.sessionUser()?.role;
    const map: Record<SkyflowRole, string> = {
      ADMIN: 'ADMIN_USERS_PAGE.ROLE_ADMIN',
      PLANNING: 'ADMIN_USERS_PAGE.ROLE_PLANNING',
      WORKER: 'ADMIN_USERS_PAGE.ROLE_WORKER',
      STATION_MANAGER: 'ADMIN_USERS_PAGE.ROLE_STATION_MANAGER',
      SITE_MANAGER: 'ADMIN_USERS_PAGE.ROLE_SITE_MANAGER',
    };
    return role ? map[role] : 'ADMIN_SETTINGS_PAGE.ROLE_GUEST';
  }

  currentLangLabelKey(): string {
    const c = this.lang.current();
    if (c === 'ar') return 'LANG.AR';
    if (c === 'en') return 'LANG.EN';
    return 'LANG.HE';
  }

  currentThemeLabelKey(): string {
    return this.theme.mode() === 'light'
      ? 'APP.THEME_STATE_LIGHT'
      : 'APP.THEME_STATE_DARK';
  }

  setLanguage(code: SkyflowLang): void {
    this.lang.setLanguage(code);
  }

  setTheme(mode: SkyflowTheme): void {
    this.theme.setTheme(mode);
  }

  previewInitials(): string {
    const first = this.draftFirst.trim();
    const last = this.draftLast.trim();
    const a = first[0] ?? this.user.initials()[0] ?? '?';
    const b = last[0] ?? '';
    return (a + b).toUpperCase();
  }

  onAvatarError(): void {
    this.avatarBroken = true;
  }

  saveProfile(): void {
    this.user.saveLocalProfile({
      firstName: this.draftFirst.trim(),
      lastName: this.draftLast.trim(),
      photoUrl: this.draftPhoto.trim() || null,
    });
    this.profileSaved.set(true);
    window.setTimeout(() => this.profileSaved.set(false), 2800);
  }

  checkHealth(): void {
    this.healthChecking.set(true);
    const start = performance.now();
    this.http
      .get<{ ok: boolean }>('/api/health')
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.healthMs.set(Math.round(performance.now() - start));
          this.healthStatus.set('ok');
          this.healthChecking.set(false);
        },
        error: () => {
          this.healthMs.set(null);
          this.healthStatus.set('error');
          this.healthChecking.set(false);
        },
      });
  }

  clearLocalData(): void {
    const msg = this.translate.instant('ADMIN_SETTINGS_PAGE.CLEAR_LOCAL_CONFIRM');
    if (!confirm(msg)) return;
    try {
      localStorage.removeItem(SIM_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  logout(): void {
    this.user.logout();
    void this.router.navigateByUrl('/');
  }
}
