import {
  Component,
  ElementRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { CurrentUserService } from '../core/current-user.service';
import { LanguageService, SkyflowLang } from '../core/language.service';
import { ThemeService } from '../core/theme.service';

@Component({
  selector: 'skyflow-bottom-nav',
  imports: [RouterLink, RouterLinkActive, TranslateModule],
  templateUrl: './bottom-nav.component.html',
  styleUrl: './bottom-nav.component.scss',
})
export class BottomNavComponent {
  readonly user = inject(CurrentUserService);
  readonly theme = inject(ThemeService);
  readonly langSvc = inject(LanguageService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly themeMenuOpen = signal(false);
  readonly langMenuOpen = signal(false);

  readonly langs: { code: SkyflowLang; labelKey: string }[] = [
    { code: 'he', labelKey: 'LANG.HE' },
    { code: 'ar', labelKey: 'LANG.AR' },
    { code: 'en', labelKey: 'LANG.EN' },
  ];

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (!this.host.nativeElement.contains(ev.target as Node)) {
      this.themeMenuOpen.set(false);
      this.langMenuOpen.set(false);
    }
  }

  toggleThemeMenu(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.langMenuOpen.set(false);
    this.themeMenuOpen.update((v) => !v);
  }

  toggleLangMenu(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.themeMenuOpen.set(false);
    this.langMenuOpen.update((v) => !v);
  }

  pickLang(ev: MouseEvent, code: SkyflowLang): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.langSvc.setLanguage(code);
    this.langMenuOpen.set(false);
  }

  pickDark(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.theme.setTheme('dark');
    this.themeMenuOpen.set(false);
  }

  pickLight(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.theme.setTheme('light');
    this.themeMenuOpen.set(false);
  }
}
