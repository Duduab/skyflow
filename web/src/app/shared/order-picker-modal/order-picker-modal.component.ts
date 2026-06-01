import {
  Component,
  computed,
  effect,
  HostListener,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { ProjectOrder } from '../../core/skyflow.models';
import { UiPopupComponent } from '../ui-popup/ui-popup.component';
import { OrderPickerPreview } from './order-picker.types';

@Component({
  selector: 'skyflow-order-picker-modal',
  standalone: true,
  imports: [TranslateModule, UiPopupComponent],
  templateUrl: './order-picker-modal.component.html',
  styleUrl: './order-picker-modal.component.scss',
})
export class OrderPickerModalComponent {
  readonly open = input(false);
  readonly orders = input<ProjectOrder[]>([]);
  readonly previews = input<Map<string, OrderPickerPreview>>(new Map());
  readonly loadingPreviews = input(false);
  /** שורת ״כל הפרויקטים״ / כל ההזמנות — למנהל */
  readonly includeAllOption = input(false);

  readonly titleId = input('order-picker-modal-title');

  readonly closed = output<void>();
  readonly picked = output<string | null>();

  readonly search = signal('');

  constructor() {
    effect(() => {
      if (this.open()) {
        this.search.set('');
      }
    });
  }

  readonly filteredOrders = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.orders();
    if (!q) return list;
    return list.filter((o) => o.name.toLowerCase().includes(q));
  });

  readonly showAllProjectsRow = computed(() => {
    if (!this.includeAllOption()) return false;
    return !this.search().trim();
  });

  previewFor(orderId: string): OrderPickerPreview | undefined {
    return this.previews().get(orderId);
  }

  @HostListener('document:keydown.escape')
  onEscapeClose(): void {
    if (this.open()) {
      this.closed.emit();
    }
  }

  emitClose(): void {
    this.closed.emit();
  }

  emitPick(id: string | null): void {
    this.picked.emit(id);
  }

  onSearchInput(ev: Event): void {
    this.search.set((ev.target as HTMLInputElement).value);
  }
}
