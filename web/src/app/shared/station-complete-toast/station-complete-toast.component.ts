import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { StationVariantOrder } from '../../core/station-presentation';
import { StationLabelPipe } from '../station-label.pipe';

/** Poups/Basic V3 — Figma node 2284:7606 (BRIX Templates) */
@Component({
  selector: 'skyflow-station-complete-toast',
  standalone: true,
  imports: [TranslateModule, RouterLink, StationLabelPipe],
  templateUrl: './station-complete-toast.component.html',
  styleUrl: './station-complete-toast.component.scss',
})
export class StationCompleteToastComponent {
  readonly open = input(false);
  readonly stationId = input.required<number>();
  readonly nextStationId = input<number | null>(null);
  readonly order = input<StationVariantOrder | null>(null);

  readonly dismissed = output<void>();
}
