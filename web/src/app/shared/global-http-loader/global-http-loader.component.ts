import { Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { HttpLoadingService } from '../../core/http-loading.service';
import { SkyflowLogoLoaderComponent } from '../skyflow-logo-loader/skyflow-logo-loader.component';

@Component({
  selector: 'skyflow-global-http-loader',
  imports: [TranslateModule, SkyflowLogoLoaderComponent],
  templateUrl: './global-http-loader.component.html',
  styleUrl: './global-http-loader.component.scss',
})
export class GlobalHttpLoaderComponent {
  readonly loading = inject(HttpLoadingService);
}
