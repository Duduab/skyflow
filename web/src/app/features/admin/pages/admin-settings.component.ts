import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { CurrentUserService } from '../../../core/current-user.service';
import { LanguageService } from '../../../core/language.service';
import { ThemeService } from '../../../core/theme.service';
import { LanguageSwitcherComponent } from '../../../shared/language-switcher.component';

@Component({
  selector: 'skyflow-admin-settings',
  imports: [TranslateModule, FormsModule, LanguageSwitcherComponent],
  templateUrl: './admin-settings.component.html',
  styleUrl: './admin-settings.component.scss',
})
export class AdminSettingsComponent {
  readonly user = inject(CurrentUserService);
  readonly lang = inject(LanguageService);
  readonly theme = inject(ThemeService);

  draftFirst = this.user.firstName();
  draftLast = this.user.lastName();
  draftPhoto = this.user.photoUrl() ?? '';

  saveProfile(): void {
    this.user.saveLocalProfile({
      firstName: this.draftFirst.trim(),
      lastName: this.draftLast.trim(),
      photoUrl: this.draftPhoto.trim() || null,
    });
  }

  setTheme(mode: 'light' | 'dark'): void {
    this.theme.setTheme(mode);
  }
}
