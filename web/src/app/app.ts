import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';

import { LanguageService } from './core/language.service';
import { LanguageSwitcherComponent } from './shared/language-switcher.component';
import { ThemeService } from './core/theme.service';
import { BottomNavComponent } from './shared/bottom-nav.component';
import { ThemeToggleComponent } from './shared/theme-toggle.component';
import { CurrentUserService } from './core/current-user.service';

@Component({
  selector: 'skyflow-root',
  imports: [
    RouterOutlet,
    RouterLink,
    TranslateModule,
    LanguageSwitcherComponent,
    ThemeToggleComponent,
    BottomNavComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  /** Eager init for persisted locale + document dir */
  private readonly _i18n = inject(LanguageService);
  private readonly _theme = inject(ThemeService);
  private readonly router = inject(Router);
  readonly user = inject(CurrentUserService);

  /** מסך ניהול מלא — בלי header כללי וכפתורי תחתית */
  readonly adminChromeHidden = signal(false);

  constructor() {
    const sync = () =>
      this.adminChromeHidden.set(
        this.router.url.split('?')[0].startsWith('/admin'),
      );
    sync();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(sync);
  }

  /** Light UI → dark-colored logo; dark UI → light-colored logo (header contrast). */
  readonly headerLogoSrc = computed(() =>
    this._theme.mode() === 'light'
      ? '/assets/logo/dark-mode.png'
      : '/assets/logo/bright-mode.png',
  );
}
