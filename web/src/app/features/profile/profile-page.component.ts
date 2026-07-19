import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { CurrentUserService } from '../../core/current-user.service';
import { LanguageService, SkyflowLang } from '../../core/language.service';
import { SkyflowRole } from '../../core/skyflow.models';
import { ThemeService, SkyflowTheme } from '../../core/theme.service';
import { MatIconComponent } from '../../shared/mat-icon/mat-icon.component';
import { UiButtonComponent } from '../../shared/ui-button.component';

const SIM_STORAGE_KEY = 'skyflow-order-simulations-v1';

@Component({
  selector: 'skyflow-profile-page',
  imports: [FormsModule, TranslateModule, MatIconComponent, UiButtonComponent],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.scss',
})
export class ProfilePageComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly user = inject(CurrentUserService);
  readonly theme = inject(ThemeService);
  readonly lang = inject(LanguageService);

  draftFirst = '';
  draftLast = '';
  draftPhoto = '';
  avatarBroken = false;

  readonly profileSaved = signal(false);

  readonly languages: { code: SkyflowLang; labelKey: string; glyph: string }[] = [
    { code: 'he', labelKey: 'LANG.HE', glyph: 'עב' },
    { code: 'ar', labelKey: 'LANG.AR', glyph: 'عر' },
    { code: 'en', labelKey: 'LANG.EN', glyph: 'EN' },
  ];

  ngOnInit(): void {
    this.syncDraftFromUser();
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

  setTheme(mode: SkyflowTheme): void {
    this.theme.setTheme(mode);
  }

  setLanguage(code: SkyflowLang): void {
    this.lang.setLanguage(code);
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
