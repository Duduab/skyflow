import { Component, input, output } from '@angular/core';
import { NgStyle } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

export type UiPopupSize = 'default' | 'wide' | 'full' | 'sheet';

/**
 * Popup shell — Figma Poups/Basic V4 (node 2280:1602).
 * מבנה: כותרת + אייקון, גוף, מפריד, פעולות.
 */
@Component({
  selector: 'skyflow-ui-popup',
  standalone: true,
  imports: [TranslateModule, NgStyle],
  templateUrl: './ui-popup.component.html',
  styleUrl: './ui-popup.component.scss',
})
export class UiPopupComponent {
  readonly open = input(false);
  readonly title = input('');
  readonly subtitle = input('');
  readonly titleId = input('');
  readonly size = input<UiPopupSize>('default');
  readonly closeOnScrim = input(true);
  readonly hideIcon = input(false);
  readonly zIndex = input(80);
  /** מחלקות נוספות על הפאנל (למשל accent תחנה) */
  readonly panelClass = input('');
  /** CSS vars / inline styles על הפאנל (למשל --sr-accent דינמי) */
  readonly panelStyle = input<Record<string, string> | null>(null);

  readonly closed = output<void>();

  onScrimClick(): void {
    if (this.closeOnScrim()) {
      this.closed.emit();
    }
  }

  close(): void {
    this.closed.emit();
  }
}
