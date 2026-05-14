import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { CurrentUserService } from '../core/current-user.service';
import { LanguageService, SkyflowLang } from '../core/language.service';
import { ThemeService } from '../core/theme.service';
import { ThemeToggleComponent } from './theme-toggle.component';

type NavHit = { titleKey: string; path: string };

@Component({
  selector: 'skyflow-shell-header-desktop',
  imports: [
    RouterLink,
    TranslateModule,
    ThemeToggleComponent,
  ],
  templateUrl: './shell-header-desktop.component.html',
  styleUrl: './shell-header-desktop.component.scss',
})
export class ShellHeaderDesktopComponent {
  readonly user = inject(CurrentUserService);
  readonly langSvc = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly theme = inject(ThemeService);

  private readonly profileMenu = viewChild<ElementRef<HTMLDetailsElement>>(
    'profileMenu',
  );
  private readonly langMenu = viewChild<ElementRef<HTMLDetailsElement>>(
    'langMenu',
  );
  private readonly searchField = viewChild<ElementRef<HTMLInputElement>>(
    'searchField',
  );

  readonly searchOpen = signal(false);
  readonly searchQuery = signal('');

  readonly langs: { code: SkyflowLang; labelKey: string }[] = [
    { code: 'he', labelKey: 'LANG.HE' },
    { code: 'ar', labelKey: 'LANG.AR' },
    { code: 'en', labelKey: 'LANG.EN' },
  ];

  readonly headerLogoSrc = computed(() =>
    this.theme.mode() === 'light'
      ? '/assets/logo/dark-mode.png'
      : '/assets/logo/bright-mode.png',
  );

  readonly navHits = computed((): NavHit[] => {
    const role = this.user.sessionUser()?.role;
    const hits: NavHit[] = [
      { titleKey: 'APP.HEADER_NAV_HOME', path: '/' },
      { titleKey: 'PROFILE.TITLE', path: '/profile' },
    ];
    if (
      role === 'WORKER' ||
      role === 'STATION_MANAGER' ||
      role === 'SITE_MANAGER' ||
      role === 'ADMIN' ||
      role === 'PLANNING'
    ) {
      hits.push({ titleKey: 'APP.WORKER_HUB', path: '/worker' });
    }
    if (role === 'ADMIN') {
      hits.push(
        { titleKey: 'ADMIN_NAV.DASHBOARD', path: '/admin/dashboard' },
        { titleKey: 'ADMIN_NAV.PROJECTS', path: '/admin/projects' },
        { titleKey: 'ADMIN_NAV.SCRAP', path: '/admin/scrap' },
        { titleKey: 'ADMIN_NAV.USERS', path: '/admin/users' },
        { titleKey: 'ADMIN_NAV.SIMULATION', path: '/admin/simulation' },
        { titleKey: 'ADMIN_NAV.FILES', path: '/admin/files' },
        { titleKey: 'ADMIN_NAV.SETTINGS', path: '/admin/settings' },
        { titleKey: 'ADMIN_NAV.PLANNING_NEW', path: '/admin/planning-new' },
      );
    } else if (role === 'PLANNING') {
      hits.push(
        { titleKey: 'ADMIN_NAV.PLANNING_NEW', path: '/admin/planning-new' },
        { titleKey: 'ADMIN_NAV.PROJECTS', path: '/admin/projects' },
      );
    }
    return hits;
  });

  readonly filteredHits = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const list = this.navHits();
    if (!q) return list;
    return list.filter((h) =>
      this.translate.instant(h.titleKey).toLowerCase().includes(q),
    );
  });

  @HostListener('document:keydown', ['$event'])
  onDocKey(ev: KeyboardEvent): void {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      this.toggleSearch();
    }
    if (ev.key === 'Escape' && this.searchOpen()) {
      ev.preventDefault();
      this.closeSearch();
    }
  }

  onSearchInput(v: string): void {
    this.searchQuery.set(v);
    if (!this.searchOpen()) {
      this.closeHeaderMenus();
      this.searchOpen.set(true);
    }
  }

  openSearchFromInput(): void {
    this.closeHeaderMenus();
    this.searchOpen.set(true);
    queueMicrotask(() => this.searchField()?.nativeElement?.focus());
  }

  toggleSearch(): void {
    if (this.searchOpen()) this.closeSearch();
    else {
      this.closeHeaderMenus();
      this.searchOpen.set(true);
      queueMicrotask(() => this.searchField()?.nativeElement?.focus());
    }
  }

  closeSearch(): void {
    this.searchOpen.set(false);
  }

  pickFirstHit(): void {
    const list = this.filteredHits();
    if (!list.length) return;
    void this.router.navigateByUrl(list[0]!.path);
    this.closeSearch();
  }

  private closeHeaderMenus(): void {
    this.closeProfile();
    this.closeLangMenu();
  }

  closeProfile(): void {
    const el = this.profileMenu()?.nativeElement;
    if (el) el.open = false;
  }

  closeLangMenu(): void {
    const el = this.langMenu()?.nativeElement;
    if (el) el.open = false;
  }

  pickLang(code: SkyflowLang): void {
    this.langSvc.setLanguage(code);
    this.closeLangMenu();
  }

  logout(): void {
    this.closeHeaderMenus();
    this.user.logout();
    void this.router.navigateByUrl('/login');
  }
}
