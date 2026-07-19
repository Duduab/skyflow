import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { ApiService } from './api.service';
import { CurrentUserService } from './current-user.service';
import { NotificationDto } from './skyflow.models';

/** How often to poll the notifications feed while signed in (ms). */
const POLL_INTERVAL_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly api = inject(ApiService);
  private readonly user = inject(CurrentUserService);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = signal<NotificationDto[]>([]);
  readonly unreadCount = signal(0);
  readonly loading = signal(false);

  /** Badge label — caps very large counts. */
  readonly badge = computed(() => {
    const n = this.unreadCount();
    if (n <= 0) return '';
    return n > 99 ? '99+' : String(n);
  });

  private poll: Subscription | null = null;

  constructor() {
    // Start/stop polling with the auth session so it never runs signed out.
    effect(() => {
      if (this.user.accessToken()) this.start();
      else this.stop();
    });
  }

  private start(): void {
    if (this.poll) return;
    this.poll = timer(0, POLL_INTERVAL_MS)
      .pipe(
        switchMap(() => this.api.getNotifications()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.items.set(res.items);
          this.unreadCount.set(res.unreadCount);
        },
        error: () => {
          /* transient — next tick retries */
        },
      });
  }

  private stop(): void {
    this.poll?.unsubscribe();
    this.poll = null;
    this.items.set([]);
    this.unreadCount.set(0);
  }

  /** Force an immediate refresh (e.g. when the panel opens). */
  refresh(): void {
    this.loading.set(true);
    this.api
      .getNotifications()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.items.set(res.items);
          this.unreadCount.set(res.unreadCount);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  /** Mark a single notification read — optimistic, reconciled with server. */
  markRead(id: string): void {
    const target = this.items().find((n) => n.id === id);
    if (!target || target.read) return;
    this.items.update((list) =>
      list.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    this.unreadCount.update((n) => Math.max(0, n - 1));
    this.api
      .markNotificationRead(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.unreadCount.set(res.unreadCount),
        error: () => this.refresh(),
      });
  }

  markAllRead(): void {
    if (this.unreadCount() === 0) return;
    this.items.update((list) => list.map((n) => ({ ...n, read: true })));
    this.unreadCount.set(0);
    this.api
      .markAllNotificationsRead()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.unreadCount.set(res.unreadCount),
        error: () => this.refresh(),
      });
  }
}
