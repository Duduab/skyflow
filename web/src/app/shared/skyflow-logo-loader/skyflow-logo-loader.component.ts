import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'skyflow-logo-loader',
  templateUrl: './skyflow-logo-loader.component.html',
  styleUrl: './skyflow-logo-loader.component.scss',
})
export class SkyflowLogoLoaderComponent {
  /** md — כרטיס לוגין; lg — overlay גלובלי */
  readonly size = input<'md' | 'lg'>('md');

  /**
   * מצב טבעת ההתקדמות סביב הלוגו:
   * `undefined` — טעינה דקורטיבית רגילה (ברירת מחדל, ללא שינוי).
   * מספר 0..100 — טבעת דטרמיניסטית (שלב העלאה).
   * `null` — טבעת אינדטרמיניסטית מסתובבת (שלב עיבוד בשרת).
   */
  readonly progress = input<number | null | undefined>(undefined);

  readonly logoSrc = '/assets/logo/bright-mode.png';

  /** רדיוס הטבעת ב-viewBox 100×100 (עם רווח לעובי הקו). */
  readonly radius = 45;
  readonly circumference = 2 * Math.PI * 45;

  readonly showProgress = computed(() => this.progress() !== undefined);
  readonly isIndeterminate = computed(() => this.progress() === null);

  readonly dashOffset = computed(() => {
    const p = this.progress();
    if (p == null) return 0;
    const clamped = Math.min(100, Math.max(0, p));
    return this.circumference * (1 - clamped / 100);
  });
}
