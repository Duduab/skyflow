import { Component, input } from '@angular/core';

/** Stations network icon — same artwork as bottom navigation. */
@Component({
  selector: 'skyflow-stations-icon',
  standalone: true,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="strokeWidth()"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="5.5" height="5.5" rx="1.3" />
      <rect x="15.5" y="5" width="5.5" height="5.5" rx="1.3" />
      <rect x="9.25" y="13.5" width="5.5" height="5.5" rx="1.3" />
      <path d="M8.5 7.75h7M12 10.5v3" stroke-linecap="round" />
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
  readonly strokeWidth = input(1.9);
}
