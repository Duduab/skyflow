import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { finalize, take } from 'rxjs/operators';

import { LanguageService } from '../../../core/language.service';
import { ItemCardComponent } from '../../plan-upload/item-card.component';
import {
  PlanUploadResponseDto,
  PlanUploadService,
} from '../../plan-upload/plan-upload.service';

@Component({
  selector: 'skyflow-admin-purchase-orders',
  standalone: true,
  imports: [CommonModule, RouterLink, DatePipe, TranslateModule, ItemCardComponent],
  templateUrl: './admin-purchase-orders.component.html',
  styleUrl: './admin-purchase-orders.component.scss',
})
export class AdminPurchaseOrdersComponent implements OnInit {
  private readonly planUpload = inject(PlanUploadService);
  private readonly lang = inject(LanguageService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly orders = signal<PlanUploadResponseDto[]>([]);

  readonly selectedOrder = signal<PlanUploadResponseDto | null>(null);
  readonly modalViewMode = signal<'table' | 'cards'>('table');
  readonly modalCardImages = signal<Record<number, string>>({});

  readonly previewUrl = signal<string | null>(null);
  readonly previewLoading = signal(false);

  readonly totalItems = computed(() =>
    this.orders().reduce((sum, o) => sum + (o.bomData?.items?.length ?? 0), 0),
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.planUpload
      .listPurchaseOrders()
      .pipe(
        take(1),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (orders) => this.orders.set(orders),
        error: () => this.error.set('ADMIN_PURCHASE_ORDERS.LOAD_ERROR'),
      });
  }

  dateLocale(): string {
    const c = this.lang.current();
    if (c === 'en') return 'en-GB';
    if (c === 'ar') return 'ar';
    return 'he-IL';
  }

  itemCount(order: PlanUploadResponseDto): number {
    return order.bomData?.items?.length ?? 0;
  }

  openOrder(order: PlanUploadResponseDto): void {
    this.selectedOrder.set(order);
    this.modalViewMode.set('table');
    this.modalCardImages.set({});
  }

  closeOrder(): void {
    this.selectedOrder.set(null);
    this.modalCardImages.set({});
  }

  setModalView(mode: 'table' | 'cards'): void {
    this.modalViewMode.set(mode);
    if (mode === 'cards') {
      this.loadModalCardImages();
    }
  }

  private loadModalCardImages(): void {
    const order = this.selectedOrder();
    if (!order) return;
    order.bomData.items.forEach((item, index) => {
      if (!item.drawingImageUrl || this.modalCardImages()[index]) return;
      this.planUpload
        .getDrawingPreview(item.drawingImageUrl)
        .pipe(take(1))
        .subscribe({
          next: ({ url }) =>
            this.modalCardImages.update((map) => ({ ...map, [index]: url })),
          error: () => undefined,
        });
    });
  }

  openDrawingPreview(objectUrl: string): void {
    if (!objectUrl) return;
    this.previewLoading.set(true);
    this.planUpload
      .getDrawingPreview(objectUrl)
      .pipe(
        take(1),
        finalize(() => this.previewLoading.set(false)),
      )
      .subscribe({
        next: ({ url }) => this.previewUrl.set(url),
        error: () => undefined,
      });
  }

  closePreview(): void {
    this.previewUrl.set(null);
  }
}
