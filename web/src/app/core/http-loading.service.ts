import { Injectable, signal } from '@angular/core';

/** מונה בקשות REST פעילות + overlay גלובלי */
@Injectable({ providedIn: 'root' })
export class HttpLoadingService {
  private pending = 0;
  private showTimer: ReturnType<typeof setTimeout> | null = null;

  readonly visible = signal(false);

  /**
   * משימה עם התקדמות (למשל ניתוח PDF): כותרת i18n + אחוז.
   * `progress` = 0..100 בשלב ההעלאה, `null` = שלב עיבוד (טבעת אינדטרמיניסטית).
   * כשאין משימה — `label` הוא null וה-overlay מציג את טעינת הברירת־מחדל.
   */
  readonly label = signal<string | null>(null);
  readonly progress = signal<number | null>(null);

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

  /** התחלת משימה עם כותרת — מציג את ה-overlay מיד עם אחוז 0 (שלב העלאה). */
  beginTask(labelKey: string): void {
    this.label.set(labelKey);
    this.progress.set(0);
    this.visible.set(true);
  }

  /** עדכון אחוז ההעלאה (0..100). */
  setProgress(pct: number): void {
    const clamped = Math.min(100, Math.max(0, Math.round(pct)));
    this.progress.set(clamped);
  }

  /** מעבר לשלב העיבוד בשרת — טבעת אינדטרמיניסטית (ללא אחוז). */
  enterProcessing(): void {
    this.progress.set(null);
  }

  /** סיום המשימה — ניקוי הכותרת וההתקדמות. */
  endTask(): void {
    this.label.set(null);
    this.progress.set(null);
  }
}
