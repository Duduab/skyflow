import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { CurrentUserService } from '../../core/current-user.service';
import { LanguageService, SkyflowLang } from '../../core/language.service';
import { ThemeService, SkyflowTheme } from '../../core/theme.service';
import { UiButtonComponent } from '../../shared/ui-button.component';

@Component({
  selector: 'skyflow-profile-page',
  imports: [FormsModule, TranslateModule, UiButtonComponent],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.scss',
})
export class ProfilePageComponent {
  readonly user = inject(CurrentUserService);
  readonly theme = inject(ThemeService);
  readonly lang = inject(LanguageService);

  readonly saved = signal(false);

  readonly langs: { code: SkyflowLang; labelKey: string; short: string }[] = [
    { code: 'he', labelKey: 'LANG.HE', short: 'HE' },
    { code: 'ar', labelKey: 'LANG.AR', short: 'AR' },
    { code: 'en', labelKey: 'LANG.EN', short: 'EN' },
  ];

  draftFirst = this.user.firstName();
  draftLast = this.user.lastName();

  saveProfile(): void {
    this.user.saveLocalProfile({
      firstName: this.draftFirst.trim(),
      lastName: this.draftLast.trim(),
    });
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2200);
  }

  setTheme(mode: SkyflowTheme): void {
    this.theme.setTheme(mode);
  }

  setLanguage(code: SkyflowLang): void {
    this.lang.setLanguage(code);
  }
}
