import {
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { fromEvent } from 'rxjs';

import { CurrentUserService } from '../../../core/current-user.service';
import { MatIconComponent } from '../../../shared/mat-icon/mat-icon.component';

@Component({
  selector: 'skyflow-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslateModule, MatIconComponent],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss',
})
export class AdminLayoutComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly auth = inject(CurrentUserService);

  /** מסלול משנה לסימון Active */
  readonly currentPath = signal('');

  /** טאבלט ומטה: מגירת ניווט פתוחה */
  readonly navOpen = signal(false);

  ngOnInit(): void {
    const sync = () => {
      const u = this.router.url.split('?')[0];
      this.currentPath.set(u);
    };
    sync();
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        sync();
        this.closeNav();
      });

    const mq =
      typeof window !== 'undefined'
        ? window.matchMedia('(min-width: 1024px)')
        : null;
    if (mq) {
      const onMq = () => {
        if (mq.matches) {
          this.closeNav();
        }
      };
      mq.addEventListener('change', onMq);
      this.destroyRef.onDestroy(() =>
        mq.removeEventListener('change', onMq),
      );
    }

    fromEvent<KeyboardEvent>(document, 'keydown')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => {
        if (e.key === 'Escape' && this.navOpen()) {
          this.closeNav();
        }
      });
  }

  toggleNav(): void {
    this.navOpen.update((v) => !v);
    this.syncBodyScrollLock();
  }

  closeNav(): void {
    if (!this.navOpen()) return;
    this.navOpen.set(false);
    this.syncBodyScrollLock();
  }

  private syncBodyScrollLock(): void {
    if (typeof document === 'undefined') return;
    const tablet =
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 1023px)').matches;
    document.body.style.overflow =
      tablet && this.navOpen() ? 'hidden' : '';
  }

  active(prefix: string): boolean {
    const p = this.currentPath();
    return p === prefix || p.startsWith(prefix + '/');
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/');
  }
}
