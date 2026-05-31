import { Component, input } from '@angular/core';

/**
 * אייקון Material Symbols Outlined — שם ה-ligature כמו ב-Google Fonts
 * (למשל login, delete, add). גופן נטען גלובלית מ-styles.scss.
 */
@Component({
  selector: 'skyflow-mat-icon',
  standalone: true,
  template: `
    <span
      class="sf-mat-icon material-symbols-outlined"
      [class.sf-mat-icon--filled]="filled()"
      [style.font-size.px]="size()"
      [style.font-variation-settings]="variation()"
      aria-hidden="true"
      >{{ icon() }}</span
    >
  `,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
      flex-shrink: 0;
    }

    .sf-mat-icon {
      line-height: 1;
      user-select: none;
    }
  `,
})
export class MatIconComponent {
  /** שם האייקון ב-Material Symbols (למשל login, check, close) */
  readonly icon = input.required<string>();
  readonly size = input(22);
  readonly filled = input(false);
  /** משקל קו — 300 עדין, 400 רגיל */
  readonly weight = input(400);

  protected variation(): string {
    const fill = this.filled() ? 1 : 0;
    const wght = this.weight();
    const opsz = Math.min(48, Math.max(20, this.size()));
    return `'FILL' ${fill}, 'wght' ${wght}, 'GRAD' 0, 'opsz' ${opsz}`;
  }
}
