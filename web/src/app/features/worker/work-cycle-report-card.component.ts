import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { StationWorkCycleRow } from '../../core/skyflow.models';
import { MatIconComponent } from '../../shared/mat-icon/mat-icon.component';

@Component({
  selector: 'skyflow-work-cycle-report-card',
  standalone: true,
  imports: [TranslateModule, DecimalPipe, MatIconComponent],
  templateUrl: './work-cycle-report-card.component.html',
  styleUrl: './work-cycle-report-card.component.scss',
})
export class WorkCycleReportCardComponent {
  readonly row = input.required<StationWorkCycleRow>();
  readonly stationId = input.required<number>();
  /** When set (CNC+), progress and qty display use upstream arrival instead of unit target. */
  readonly inboundQty = input<number | null>(null);
  readonly quantity = input<number | null>(null);
  readonly loading = input(false);
  /** When true, reporting is blocked (e.g. assembly checklist not complete). */
  readonly locked = input(false);
  /** Message shown while locked. */
  readonly lockedHint = input<string>('');

  readonly quantityChange = output<number | null>();
  readonly submitted = output<void>();

  readonly progressTarget = computed(() => {
    const inbound = this.inboundQty();
    if (inbound != null && inbound >= 0) return inbound;
    return this.row().targetQty;
  });

  readonly displayInboundQty = computed(() => {
    const inbound = this.inboundQty();
    if (inbound != null && inbound >= 0) return inbound;
    return this.row().remaining;
  });

  readonly reportRemaining = computed(() => {
    const inbound = this.inboundQty();
    if (inbound != null && inbound >= 0) {
      return Math.max(0, inbound - this.row().processedQty);
    }
    return this.row().remaining;
  });

  readonly progressPercent = computed(() => {
    const target = this.progressTarget();
    if (target <= 0) return 0;
    return Math.min(
      100,
      Math.round((this.row().processedQty / target) * 100),
    );
  });

  nudge(delta: number): void {
    const value = this.quantity() ?? 0;
    const next = Math.max(
      0,
      Math.min(this.reportRemaining(), value + delta),
    );
    this.quantityChange.emit(next || null);
  }

  fillRemaining(): void {
    const remaining = this.reportRemaining();
    if (remaining > 0) this.quantityChange.emit(remaining);
  }

  submit(): void {
    if (!this.loading() && !this.locked() && (this.quantity() ?? 0) > 0) {
      this.submitted.emit();
    }
  }
}
