import { Component, input } from '@angular/core';

/** Work-station bays along a production line — subtle outline icon. */
@Component({
  selector: 'skyflow-stations-icon',
  standalone: true,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="strokeWidth()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3.75 16.25h16.5" opacity="0.28" />
      <rect x="3.75" y="9" width="4.5" height="7.25" rx="1.15" />
      <rect x="9.75" y="9" width="4.5" height="7.25" rx="1.15" />
      <rect x="15.75" y="9" width="4.5" height="7.25" rx="1.15" />
      <path d="M5.2 12.8h1.6M11.2 12.8h1.6M17.2 12.8h1.6" opacity="0.42" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
      flex-shrink: 0;
    }

    svg {
      width: var(--skyflow-stations-icon-size, 1.125rem);
      height: var(--skyflow-stations-icon-size, 1.125rem);
    }
  `,
  host: {
    '[style.--skyflow-stations-icon-size.px]': 'size()',
  },
})
export class StationsIconComponent {
  readonly size = input(18);
  readonly strokeWidth = input(1.3);
}
