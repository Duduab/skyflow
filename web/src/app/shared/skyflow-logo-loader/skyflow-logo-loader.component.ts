import { Component, input } from '@angular/core';

@Component({
  selector: 'skyflow-logo-loader',
  templateUrl: './skyflow-logo-loader.component.html',
  styleUrl: './skyflow-logo-loader.component.scss',
})
export class SkyflowLogoLoaderComponent {
  /** md — כרטיס לוגין; lg — overlay גלובלי */
  readonly size = input<'md' | 'lg'>('md');

  readonly logoSrc = '/assets/logo/bright-mode.png';
}
