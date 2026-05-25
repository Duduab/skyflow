import { Injectable, signal } from '@angular/core';

/** מונה בקשות REST פעילות + overlay גלובלי */
@Injectable({ providedIn: 'root' })
export class HttpLoadingService {
  private pending = 0;
  private showTimer: ReturnType<typeof setTimeout> | null = null;

  readonly visible = signal(false);

  start(): void {
    this.pending++;
    if (this.pending !== 1) return;
    this.showTimer = setTimeout(() => {
      if (this.pending > 0) {
        this.visible.set(true);
      }
    }, 120);
  }

  end(): void {
    this.pending = Math.max(0, this.pending - 1);
    if (this.pending !== 0) return;
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    this.visible.set(false);
  }
}
