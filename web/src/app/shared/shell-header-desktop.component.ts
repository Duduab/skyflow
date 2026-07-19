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

import { avatarIconForRole } from '../core/user-avatar-icon.util';
import { CurrentUserService } from '../core/current-user.service';
import { LanguageService, SkyflowLang } from '../core/language.service';
import { NotificationsService } from '../core/notifications.service';
import { NotificationDto, NotificationKind } from '../core/skyflow.models';
import { MatIconComponent } from './mat-icon/mat-icon.component';
import { ThemeToggleComponent } from './theme-toggle.component';

type NavHit = { titleKey: string; path: string };

/** Material Symbol per notification kind. */
const NOTIF_ICONS: Record<NotificationKind, string> = {
  CYCLE_LAUNCHED: 'rocket_launch',
  CYCLE_REPORTED: 'conveyor_belt',
  CYCLE_COMPLETED: 'task_alt',
  CYCLE_RETURNED: 'undo',
  STATION_LOG: 'factory',
  DAILY_TARGET_MANUAL: 'flag',
  DELIVERY_NOTE_ISSUED: 'local_shipping',
  ELEVATION_CELL_DONE: 'grid_view',
  ELEVATION_DEFECT: 'report',
  PLANNING_APPROVED: 'verified',
  PROJECT_COMPLETED: 'celebration',
  TRACKING_BEAT: 'timeline',
};

@Component({
  selector: 'skyflow-shell-header-desktop',
  imports: [
    RouterLink,
    TranslateModule,
    ThemeToggleComponent,
    MatIconComponent,
  ],
  templateUrl: './shell-header-desktop.component.html',
  styleUrl: './shell-header-desktop.component.scss',
})
export class ShellHeaderDesktopComponent {
  readonly user = inject(CurrentUserService);
  readonly langSvc = inject(LanguageService);
  readonly notifs = inject(NotificationsService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  private readonly profileMenu = viewChild<ElementRef<HTMLDetailsElement>>(
    'profileMenu',
  );
  private readonly langMenu = viewChild<ElementRef<HTMLDetailsElement>>(
    'langMenu',
  );
  private readonly notifMenu = viewChild<ElementRef<HTMLDetailsElement>>(
    'notifMenu',
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

  readonly headerLogoSrc = computed(() => '/assets/logo/bright-mode.png');

  /** Role-based avatar icon shown when the user has no profile photo. */
  readonly avatarIcon = computed(() =>
    avatarIconForRole(this.user.sessionUser()?.role),
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
        { titleKey: 'ADMIN_NAV.PLANNING_DRAFTS', path: '/admin/planning-drafts' },
      );
    } else if (role === 'PLANNING') {
      hits.push(
        { titleKey: 'ADMIN_NAV.PLANNING_NEW', path: '/admin/planning-new' },
        { titleKey: 'ADMIN_NAV.PLANNING_DRAFTS', path: '/admin/planning-drafts' },
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
    this.closeNotifMenu();
  }

  closeProfile(): void {
    const el = this.profileMenu()?.nativeElement;
    if (el) el.open = false;
  }

  closeLangMenu(): void {
    const el = this.langMenu()?.nativeElement;
    if (el) el.open = false;
  }

  closeNotifMenu(): void {
    const el = this.notifMenu()?.nativeElement;
    if (el) el.open = false;
  }

  /** Toggle handler on the bell — refresh the feed when it opens. */
  onNotifToggle(open: boolean): void {
    if (open) this.notifs.refresh();
  }

  iconForNotif(kind: NotificationKind): string {
    return NOTIF_ICONS[kind] ?? 'notifications';
  }

  onNotifClick(n: NotificationDto): void {
    this.notifs.markRead(n.id);
    this.closeNotifMenu();
    if (n.link) void this.router.navigateByUrl(n.link);
  }

  markAllNotifsRead(ev: Event): void {
    ev.stopPropagation();
    this.notifs.markAllRead();
  }

  /** Localized relative time (e.g. "לפני 5 דק'"). */
  timeAgo(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const diffSec = Math.round((then - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    const rtf = new Intl.RelativeTimeFormat(this.langSvc.current(), {
      numeric: 'auto',
    });
    if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    return rtf.format(Math.round(diffSec / 86400), 'day');
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
