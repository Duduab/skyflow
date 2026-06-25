import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { finalize, take } from 'rxjs/operators';

import { ApiService } from '../../../core/api.service';
import { AdminDeliveryNoteRow } from '../../../core/skyflow.models';
import { LanguageService } from '../../../core/language.service';
import { UiButtonComponent } from '../../../shared/ui-button.component';
import { UiPopupComponent } from '../../../shared/ui-popup/ui-popup.component';
import { UiSelectComponent } from '../../../shared/ui-select/ui-select.component';
import { UiSelectOption } from '../../../shared/ui-select/ui-select.types';

@Component({
  selector: 'skyflow-admin-delivery-notes',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    TranslateModule,
    UiButtonComponent,
    UiPopupComponent,
    UiSelectComponent,
  ],
  templateUrl: './admin-delivery-notes.component.html',
  styleUrl: './admin-delivery-notes.component.scss',
})
export class AdminDeliveryNotesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly lang = inject(LanguageService);
  private readonly translate = inject(TranslateService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notes = signal<AdminDeliveryNoteRow[]>([]);
  readonly projectFilter = signal('');
  readonly selected = signal<AdminDeliveryNoteRow | null>(null);
  readonly editing = signal(false);
  readonly editShippingType = signal<'INTERNAL' | 'EXTERNAL'>('INTERNAL');
  readonly editExternalPrice = signal('');
  readonly actionBusy = signal(false);
  readonly actionError = signal<string | null>(null);

  readonly filteredNotes = computed(() => {
    const pf = this.projectFilter();
    const rows = this.notes();
    if (!pf) return rows;
    return rows.filter((n) => n.projectId === pf);
  });

  readonly stats = computed(() => {
    const rows = this.notes();
    const internal = rows.filter((n) => n.shippingType === 'INTERNAL').length;
    const external = rows.filter((n) => n.shippingType === 'EXTERNAL').length;
    return { total: rows.length, internal, external };
  });

  readonly projectOptions = computed((): UiSelectOption[] => {
    const map = new Map<string, string>();
    for (const n of this.notes()) {
      map.set(n.projectId, n.projectName);
    }
    return [
      { value: '', label: this.translate.instant('ADMIN_DELIVERY_NOTES.FILTER_ALL') },
      ...[...map.entries()].map(([value, label]) => ({ value, label })),
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .getAdminDeliveryNotes()
      .pipe(
        take(1),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (rows) => this.notes.set(rows),
        error: () => this.error.set('ADMIN_DELIVERY_NOTES.LOAD_ERROR'),
      });
  }

  dateLocale(): string {
    const c = this.lang.current();
    if (c === 'en') return 'en-GB';
    if (c === 'ar') return 'ar';
    return 'he-IL';
  }

  onProjectFilterChange(value: string | number | null): void {
    this.projectFilter.set(value == null ? '' : String(value));
  }

  shippingLabelKey(type: 'INTERNAL' | 'EXTERNAL'): string {
    return type === 'EXTERNAL'
      ? 'ADMIN_DELIVERY_NOTES.SHIPPING_EXTERNAL'
      : 'ADMIN_DELIVERY_NOTES.SHIPPING_INTERNAL';
  }

  openNote(note: AdminDeliveryNoteRow): void {
    this.selected.set(note);
    this.editing.set(false);
    this.actionError.set(null);
  }

  closeNote(): void {
    if (this.actionBusy()) return;
    this.selected.set(null);
    this.editing.set(false);
    this.actionError.set(null);
  }

  startEdit(note: AdminDeliveryNoteRow): void {
    this.editShippingType.set(note.shippingType);
    this.editExternalPrice.set(note.externalPrice ?? '');
    this.editing.set(true);
    this.actionError.set(null);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.actionError.set(null);
  }

  editShippingOptions(): UiSelectOption[] {
    return [
      {
        value: 'INTERNAL',
        label: this.translate.instant('ADMIN_DELIVERY_NOTES.SHIPPING_INTERNAL'),
      },
      {
        value: 'EXTERNAL',
        label: this.translate.instant('ADMIN_DELIVERY_NOTES.SHIPPING_EXTERNAL'),
      },
    ];
  }

  onEditShippingChange(value: string | number | null): void {
    const v = value == null ? 'INTERNAL' : String(value);
    this.editShippingType.set(v === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL');
  }

  saveEdit(): void {
    const note = this.selected();
    if (!note || note.status !== 'ACTIVE') return;
    const shippingType = this.editShippingType();
    let externalPrice: number | null | undefined = undefined;
    if (shippingType === 'EXTERNAL') {
      const raw = this.editExternalPrice().trim().replace(',', '.');
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        this.actionError.set('ADMIN_DELIVERY_NOTES.ERR_PRICE');
        return;
      }
      externalPrice = n;
    } else {
      externalPrice = null;
    }
    this.actionBusy.set(true);
    this.actionError.set(null);
    this.api
      .updateAdminDeliveryNote(note.id, { shippingType, externalPrice })
      .pipe(
        take(1),
        finalize(() => this.actionBusy.set(false)),
      )
      .subscribe({
        next: (res) => {
          this.notes.update((rows) =>
            rows.map((r) =>
              r.id === note.id
                ? {
                    ...r,
                    shippingType: res.shippingType,
                    externalPrice: res.externalPrice,
                    documentUrl: res.documentUrl,
                  }
                : r,
            ),
          );
          this.selected.set({
            ...note,
            shippingType: res.shippingType,
            externalPrice: res.externalPrice,
            documentUrl: res.documentUrl,
          });
          this.editing.set(false);
        },
        error: () => this.actionError.set('ADMIN_DELIVERY_NOTES.ERR_UPDATE'),
      });
  }

  cancelNote(): void {
    const note = this.selected();
    if (!note || note.status !== 'ACTIVE') return;
    if (!confirm(this.translate.instant('ADMIN_DELIVERY_NOTES.CANCEL_CONFIRM'))) {
      return;
    }
    this.actionBusy.set(true);
    this.actionError.set(null);
    this.api
      .cancelAdminDeliveryNote(note.id)
      .pipe(
        take(1),
        finalize(() => this.actionBusy.set(false)),
      )
      .subscribe({
        next: () => {
          this.notes.update((rows) =>
            rows.map((r) =>
              r.id === note.id ? { ...r, status: 'CANCELLED' as const } : r,
            ),
          );
          this.selected.set({ ...note, status: 'CANCELLED' });
        },
        error: () => this.actionError.set('ADMIN_DELIVERY_NOTES.ERR_CANCEL'),
      });
  }

  openDocument(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
