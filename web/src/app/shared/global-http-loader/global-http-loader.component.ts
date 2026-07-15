import { Component, computed, inject } from '@angular/core';
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

  /** התקדמות לטבעת: רק כשיש משימה פעילה — אחרת undefined (טעינה רגילה). */
  readonly ringProgress = computed(() =>
    this.loading.label() !== null ? this.loading.progress() : undefined,
  );

  /** האם להציג אחוז מספרי (רק בשלב ההעלאה, כשההתקדמות אינה null). */
  readonly showPercent = computed(
    () => this.loading.label() !== null && this.loading.progress() !== null,
  );
}
