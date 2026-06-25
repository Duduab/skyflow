import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { BomItemDto } from './plan-upload.service';

/**
 * Item card built to match the Figma "Card Components" design (node 1:1185),
 * adapted to RTL and to the manufacturing BOM fields:
 * - header  : teal triangle + the item drawing (שרטוט)
 * - title   : flame icon + description (תיאור הפריט)
 * - details : מק״ט / יחידות / מ״א / גוון
 * - footer  : "שם הספק" + supplier value (ספק), no avatar / no menu
 * The card inherits the app font (Assistant) by design.
 */
@Component({
  selector: 'skyflow-item-card',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  host: { class: 'block h-full' },
  template: `
    <article
      dir="rtl"
      class="flex h-full w-full flex-col overflow-hidden rounded-[16px] bg-white text-right shadow-[0_8px_22px_rgba(0,0,0,0.16)]"
    >
      <!-- card-header: item drawing only -->
      <div class="relative flex h-[190px] w-full items-center justify-center overflow-hidden p-[16px]">
        @if (imageUrl) {
          <img
            [src]="imageUrl"
            alt=""
            (click)="openImage.emit()"
            class="relative z-10 max-h-[160px] max-w-[85%] cursor-pointer object-contain [mix-blend-mode:multiply]"
          />
        }
      </div>

      <!-- card-body: title + details -->
      <div class="flex w-full flex-col gap-[8px] px-[16px] pt-[12px]">
        <div class="flex items-center gap-[8px]">
          <span class="shrink-0" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M3.5 7 12 11.8V21.8L3.5 17Z" fill="#3a2fd6" />
              <path d="M12 11.8 20.5 7V17L12 21.8Z" fill="#4a3aff" />
              <path d="M12 2.2 20.5 7 12 11.8 3.5 7Z" fill="#897fff" />
            </svg>
          </span>
          <h3 class="m-0 break-words text-[20px] font-bold leading-[1.15] text-black">
            {{ item.description }}
          </h3>
        </div>

        <div class="flex flex-col gap-[2px] text-[13px] leading-[18px] tracking-[0.3px] text-black">
          @if (item.sku) {
            <p class="m-0">
              <span class="text-[#78858F]">{{ 'UPLOAD_PLAN.SKU' | translate }}:</span>
              {{ item.sku }}
            </p>
          }
          @if (item.units) {
            <p class="m-0">
              <span class="text-[#78858F]">{{ 'UPLOAD_PLAN.QUANTITY' | translate }}:</span>
              {{ item.units }}
            </p>
          }
          @if (item.meters) {
            <p class="m-0">
              <span class="text-[#78858F]">{{ 'UPLOAD_PLAN.DIMENSIONS' | translate }}:</span>
              {{ item.meters }}
            </p>
          }
          @if (item.shade) {
            <p class="m-0">
              <span class="text-[#78858F]">{{ 'UPLOAD_PLAN.SHADE' | translate }}:</span>
              {{ item.shade }}
            </p>
          }
        </div>
      </div>

      <!-- card-footer: supplier (no avatar / no menu) -->
      <div class="mt-auto flex w-full flex-col gap-[2px] p-[16px]">
        <p class="m-0 text-[15px] font-medium text-black">
          {{ 'UPLOAD_PLAN.SUPPLIER_NAME' | translate }}
        </p>
        <p class="m-0 text-[12px] tracking-[0.3px] text-[#78858F]">{{ item.supplier }}</p>
      </div>
    </article>
  `,
})
export class ItemCardComponent {
  @Input({ required: true }) item!: BomItemDto;
  @Input() imageUrl: string | null = null;
  @Output() openImage = new EventEmitter<void>();
}
