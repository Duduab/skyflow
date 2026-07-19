import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { filter, map, startWith } from 'rxjs/operators';

import { CurrentUserService } from '../core/current-user.service';
import { LanguageService, SkyflowLang } from '../core/language.service';
import {
  buildNavSearchHits,
  filterNavSearchHits,
} from '../core/nav-search';
import {
  stationLabelKey,
  stationMatIcon,
  stationMatIconFilled,
  stationVisualTokens,
  workerFlowSequence,
} from '../core/station-presentation';
import { MatIconComponent } from './mat-icon/mat-icon.component';

interface StationNavItem {
  id: number;
  labelKey: string;
  icon: string;
  iconFilled: boolean;
  accent: string;
}

interface FloorCenterStation {
  id: number;
  labelKey: string;
  icon: string;
  iconFilled: boolean;
  accent: string;
}

@Component({
  selector: 'skyflow-bottom-nav',
  imports: [
    RouterLink,
    RouterLinkActive,
    TranslateModule,
    MatIconComponent,
    NgTemplateOutlet,
  ],
  templateUrl: './bottom-nav.component.html',
  styleUrl: './bottom-nav.component.scss',
})
export class BottomNavComponent {
  readonly user = inject(CurrentUserService);
  readonly langSvc = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly host = inject(ElementRef<HTMLElement>);

  private readonly searchField = viewChild<ElementRef<HTMLInputElement>>(
    'searchField',
  );

  private readonly routerUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly langMenuOpen = signal(false);
  readonly stationsMenuOpen = signal(false);
  readonly searchMenuOpen = signal(false);
  readonly searchQuery = signal('');

  /** Last station picked in the nav (or from the current /worker/:id route). */
  readonly selectedStationId = signal<number | null>(
    this.user.sessionUser()?.managedStationId ?? null,
  );

  private readonly syncStationFromRoute = effect(() => {
    const match = this.routerUrl().match(/\/worker\/(\d+)/);
    if (match) {
      this.selectedStationId.set(Number(match[1]));
    }
  });

  /** Admin & planning roles get a quick stations dropdown from the center button. */
  readonly centerOpensMenu = computed(
    () => this.user.isAdmin() || this.user.isPlanningRole(),
  );

  /** Floor staff get a dedicated stations tab and a station-specific center button. */
  readonly showFloorStationsTab = computed(() => this.user.isFloorStaffRole());

  readonly activeStationId = computed(() => this.selectedStationId());

  readonly floorCenterStation = computed((): FloorCenterStation | null => {
    if (!this.showFloorStationsTab()) return null;
    const id = this.selectedStationId();
    if (!id) return null;
    return {
      id,
      labelKey: stationLabelKey(null, id),
      icon: stationMatIcon(id),
      iconFilled: stationMatIconFilled(id),
      accent: stationVisualTokens(null, id).accent,
    };
  });

  readonly floorCenterLink = computed((): string | (string | number)[] => {
    const st = this.floorCenterStation();
    return st ? ['/worker', st.id] : ['/worker'];
  });

  readonly isWorkerHubRoute = computed(() => {
    const path = this.routerUrl().split('?')[0]?.split('#')[0] ?? '';
    return path === '/worker';
  });

  readonly navSearchHits = computed(() =>
    buildNavSearchHits(this.user.sessionUser()?.role),
  );

  readonly filteredSearchHits = computed(() =>
    filterNavSearchHits(
      this.navSearchHits(),
      this.searchQuery(),
      (key) => this.translate.instant(key),
    ),
  );

  /** All production stations (physical flow order) with their per-station visual. */
  readonly stations: StationNavItem[] = workerFlowSequence(false).map((id) => ({
    id,
    labelKey: stationLabelKey(null, id),
    icon: stationMatIcon(id),
    iconFilled: stationMatIconFilled(id),
    accent: stationVisualTokens(null, id).accent,
  }));

  readonly langs: { code: SkyflowLang; labelKey: string }[] = [
    { code: 'he', labelKey: 'LANG.HE' },
    { code: 'ar', labelKey: 'LANG.AR' },
    { code: 'en', labelKey: 'LANG.EN' },
  ];

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (!this.host.nativeElement.contains(ev.target as Node)) {
      this.langMenuOpen.set(false);
      this.stationsMenuOpen.set(false);
      this.searchMenuOpen.set(false);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && this.searchMenuOpen()) {
      ev.preventDefault();
      this.closeSearchMenu();
    }
  }

  toggleLangMenu(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.stationsMenuOpen.set(false);
    this.searchMenuOpen.set(false);
    this.langMenuOpen.update((v) => !v);
  }

  pickLang(ev: MouseEvent, code: SkyflowLang): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.langSvc.setLanguage(code);
    this.langMenuOpen.set(false);
  }

  toggleStationsMenu(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.langMenuOpen.set(false);
    this.searchMenuOpen.set(false);
    this.stationsMenuOpen.update((v) => !v);
  }

  closeStationsMenu(): void {
    this.stationsMenuOpen.set(false);
  }

  pickStation(id: number): void {
    this.selectedStationId.set(id);
    this.closeStationsMenu();
    void this.router.navigate(['/worker', id]);
  }

  toggleSearchMenu(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.langMenuOpen.set(false);
    this.stationsMenuOpen.set(false);
    if (this.searchMenuOpen()) {
      this.closeSearchMenu();
      return;
    }
    this.searchMenuOpen.set(true);
    queueMicrotask(() => this.searchField()?.nativeElement?.focus());
  }

  closeSearchMenu(): void {
    this.searchMenuOpen.set(false);
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
  }

  pickSearchHit(path: string): void {
    this.closeSearchMenu();
    void this.router.navigateByUrl(path);
  }

  pickFirstSearchHit(): void {
    const list = this.filteredSearchHits();
    if (!list.length) return;
    this.pickSearchHit(list[0]!.path);
  }
}
