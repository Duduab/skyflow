import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';

import { LanguageService } from './core/language.service';
import { BottomNavComponent } from './shared/bottom-nav.component';
import { GlobalHttpLoaderComponent } from './shared/global-http-loader/global-http-loader.component';
import { ShellHeaderDesktopComponent } from './shared/shell-header-desktop.component';
import { CurrentUserService } from './core/current-user.service';

@Component({
  selector: 'skyflow-root',
  imports: [
    RouterOutlet,
    BottomNavComponent,
    ShellHeaderDesktopComponent,
    GlobalHttpLoaderComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  /** Eager init for persisted locale + document dir */
  private readonly _i18n = inject(LanguageService);
  private readonly router = inject(Router);
  readonly user = inject(CurrentUserService);

  /** מסך מלא (ניהול / לוגין) — בלי padding של main, header וכפתורי תחתית */
  readonly adminChromeHidden = signal(false);

  constructor() {
    const sync = () => {
      const path = this.router.url.split('?')[0];
      this.adminChromeHidden.set(
        path.startsWith('/admin') || path === '/login',
      );
    };
    sync();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(sync);
  }
}
