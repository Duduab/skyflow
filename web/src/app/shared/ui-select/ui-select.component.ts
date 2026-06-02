import { DOCUMENT } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  forwardRef,
  inject,
  input,
  output,
  Renderer2,
  signal,
  viewChild,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { MatIconComponent } from '../mat-icon/mat-icon.component';
import { UiSelectOption, UiSelectSize } from './ui-select.types';

let nextSelectId = 0;

@Component({
  selector: 'skyflow-ui-select',
  standalone: true,
  imports: [MatIconComponent, TranslateModule],
  templateUrl: './ui-select.component.html',
  styleUrl: './ui-select.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => UiSelectComponent),
      multi: true,
    },
  ],
  host: {
    class: 'sf-ui-select-host',
    '[class.sf-ui-select-host--open]': 'open()',
  },
})
export class UiSelectComponent implements ControlValueAccessor {
  private readonly document = inject(DOCUMENT);
  private readonly renderer = inject(Renderer2);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  private readonly triggerRef =
    viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly searchInputRef =
    viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly listboxId = `sf-ui-select-listbox-${++nextSelectId}`;

  readonly options = input<UiSelectOption[]>([]);
  readonly value = input<string | number | null | undefined>(undefined);
  readonly placeholder = input('');
  readonly disabled = input(false);
  readonly size = input<UiSelectSize>('md');
  readonly triggerClass = input('');
  readonly inputId = input('');
  readonly labelledBy = input('');
  readonly searchThreshold = input(8);
  readonly searchable = input<boolean | null>(null);
  readonly emptyLabel = input('');
  readonly panelZIndex = input(250);
  /** כפה dropdown קבוע ל-viewport (למשל בתוך modal עם overflow:hidden) */
  readonly fixedPanel = input<boolean | null>(null);

  readonly valueChange = output<string | number | null>();

  readonly open = signal(false);
  readonly searchQuery = signal('');
  readonly activeIndex = signal(0);
  readonly useFixedPanel = signal(false);

  private readonly formDisabled = signal(false);
  private readonly internalValue = signal<string | number | null>(null);
  private onChange: (value: string | number | null) => void = () => {};
  private onTouched: () => void = () => {};

  readonly isDisabled = computed(() => this.disabled() || this.formDisabled());

  readonly showSearch = computed(() => {
    const forced = this.searchable();
    if (forced != null) return forced;
    return this.options().length >= this.searchThreshold();
  });

  readonly filteredOptions = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const opts = this.options();
    if (!q) return opts;
    return opts.filter((opt) => opt.label.toLowerCase().includes(q));
  });

  readonly selectedOption = computed(() => {
    const current = this.currentValue();
    return (
      this.options().find((opt) => this.valuesEqual(opt.value, current)) ?? null
    );
  });

  readonly hasSelection = computed(() => this.selectedOption() != null);

  readonly displayLabel = computed(() => {
    const selected = this.selectedOption();
    if (selected) return selected.label;
    const placeholder = this.placeholder().trim();
    if (placeholder) return placeholder;
    const translated = this.translate.instant('COMMON.SELECT_PLACEHOLDER');
    return translated === 'COMMON.SELECT_PLACEHOLDER' ? '—' : translated;
  });

  readonly chevronSize = computed(() => {
    const size = this.size();
    if (size === 'touch') return 28;
    if (size === 'hero') return 24;
    return 22;
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.close();
      this.removeListeners();
    });
  }

  writeValue(value: string | number | null): void {
    this.internalValue.set(value ?? null);
  }

  registerOnChange(fn: (value: string | number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
    if (isDisabled) this.close();
  }

  toggle(): void {
    if (this.isDisabled()) return;
    if (this.open()) {
      this.close();
    } else {
      this.openPanel();
    }
  }

  selectOption(opt: UiSelectOption): void {
    if (opt.disabled || this.isDisabled()) return;
    this.commitValue(opt.value);
    this.close();
  }

  onOptionActivate(event: Event, opt: UiSelectOption): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectOption(opt);
  }

  optionTrack(opt: UiSelectOption): string {
    if (opt.value === null) return '__null__';
    return String(opt.value);
  }

  isSelected(opt: UiSelectOption): boolean {
    return this.valuesEqual(opt.value, this.currentValue());
  }

  searchPlaceholder(): string {
    const translated = this.translate.instant('COMMON.SEARCH');
    return translated === 'COMMON.SEARCH' ? 'חיפוש…' : translated;
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
    this.activeIndex.set(0);
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!this.open()) this.openPanel();
        else if (event.key === 'Enter' || event.key === ' ') {
          this.selectActiveOption();
        } else {
          this.moveActive(event.key === 'ArrowDown' ? 1 : -1);
        }
        break;
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          this.close();
        }
        break;
      default:
        break;
    }
  }

  onSearchKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveActive(-1);
        break;
      case 'Enter':
        event.preventDefault();
        this.selectActiveOption();
        break;
      case 'Escape':
        event.preventDefault();
        this.close();
        this.triggerRef()?.nativeElement.focus();
        break;
      default:
        break;
    }
  }

  private openPanel(): void {
    this.searchQuery.set('');
    const selectedIdx = this.filteredOptions().findIndex((opt) =>
      this.isSelected(opt),
    );
    this.activeIndex.set(Math.max(selectedIdx, 0));
    this.useFixedPanel.set(this.shouldUseFixedPanel());
    this.open.set(true);

    requestAnimationFrame(() => this.setupPanelWithRetry(0));
  }

  private setupPanelWithRetry(attempt: number): void {
    const panel = this.panelRef()?.nativeElement;
    if (!panel) {
      if (attempt < 8) {
        requestAnimationFrame(() => this.setupPanelWithRetry(attempt + 1));
      }
      return;
    }

    if (this.useFixedPanel()) {
      this.syncFixedPanelPosition();
    } else {
      this.clearFixedPanelStyles(panel);
    }

    this.addListeners();

    if (this.showSearch()) {
      requestAnimationFrame(() => this.searchInputRef()?.nativeElement.focus());
    }
  }

  private close(): void {
    if (!this.open()) return;
    const panel = this.panelRef()?.nativeElement;
    if (panel) this.clearFixedPanelStyles(panel);
    this.removeListeners();
    this.searchQuery.set('');
    this.open.set(false);
    this.useFixedPanel.set(false);
    this.onTouched();
  }

  private commitValue(value: string | number | null): void {
    this.internalValue.set(value);
    this.onChange(value);
    this.valueChange.emit(value);
  }

  private currentValue(): string | number | null {
    const external = this.value();
    if (external !== undefined) return external ?? null;
    return this.internalValue();
  }

  private valuesEqual(
    a: string | number | null,
    b: string | number | null,
  ): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    return String(a) === String(b);
  }

  private selectActiveOption(): void {
    const opts = this.filteredOptions();
    const idx = this.activeIndex();
    const opt = opts[idx];
    if (opt && !opt.disabled) {
      this.selectOption(opt);
      this.triggerRef()?.nativeElement.focus();
    }
  }

  private moveActive(delta: number): void {
    const opts = this.filteredOptions();
    if (!opts.length) return;
    let idx = this.activeIndex();
    for (let step = 0; step < opts.length; step += 1) {
      idx = (idx + delta + opts.length) % opts.length;
      if (!opts[idx]?.disabled) break;
    }
    this.activeIndex.set(idx);
  }

  private shouldUseFixedPanel(): boolean {
    const forced = this.fixedPanel();
    if (forced != null) return forced;

    let el: HTMLElement | null = this.hostRef.nativeElement.parentElement;
    while (el && el !== this.document.body) {
      const style = getComputedStyle(el);
      const values = [style.overflow, style.overflowX, style.overflowY];
      if (values.some((v) => v === 'hidden' || v === 'clip')) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  private clearFixedPanelStyles(panel: HTMLElement): void {
    this.renderer.removeStyle(panel, 'position');
    this.renderer.removeStyle(panel, 'top');
    this.renderer.removeStyle(panel, 'left');
    this.renderer.removeStyle(panel, 'width');
    this.renderer.removeStyle(panel, 'right');
    this.renderer.removeStyle(panel, 'inset-inline');
    this.renderer.removeStyle(panel, 'z-index');
  }

  private syncFixedPanelPosition(): void {
    const panel = this.panelRef()?.nativeElement;
    const anchor =
      this.triggerRef()?.nativeElement ?? this.hostRef.nativeElement;
    if (!panel || !anchor) return;

    const rect = anchor.getBoundingClientRect();
    const gap = 6;
    const viewportPadding = 8;
    const panelMaxHeight = Math.min(window.innerHeight * 0.42, 256);
    const panelEstimatedHeight = Math.min(
      this.filteredOptions().length * 44 + (this.showSearch() ? 52 : 16) + 16,
      panelMaxHeight + 16,
    );

    let top = rect.bottom + gap;
    if (top + panelEstimatedHeight > window.innerHeight - viewportPadding) {
      top = Math.max(viewportPadding, rect.top - gap - panelEstimatedHeight);
    }

    let left = rect.left;
    const width = Math.max(rect.width, 160);

    const containingBlock = this.findFixedContainingBlock(
      this.hostRef.nativeElement,
    );
    if (containingBlock) {
      const cbRect = containingBlock.getBoundingClientRect();
      top -= cbRect.top;
      left -= cbRect.left;
    }

    this.renderer.setStyle(panel, 'position', 'fixed');
    this.renderer.setStyle(panel, 'top', `${top}px`);
    this.renderer.setStyle(panel, 'left', `${left}px`);
    this.renderer.setStyle(panel, 'width', `${width}px`);
    this.renderer.setStyle(panel, 'right', 'auto');
    this.renderer.setStyle(panel, 'inset-inline', 'auto');
    this.renderer.setStyle(panel, 'z-index', String(this.panelZIndex()));
  }

  /** backdrop-filter / transform יוצרים containing block — fixed לא יחסית ל-viewport */
  private findFixedContainingBlock(start: HTMLElement): HTMLElement | null {
    let el: HTMLElement | null = start.parentElement;
    while (el && el !== this.document.body) {
      if (this.createsFixedContainingBlock(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  private createsFixedContainingBlock(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    if (style.transform !== 'none') return true;
    if (style.perspective !== 'none') return true;
    if (style.filter !== 'none') return true;
    if (style.backdropFilter !== 'none') return true;
    const webkitBackdrop = (style as CSSStyleDeclaration & {
      webkitBackdropFilter?: string;
    }).webkitBackdropFilter;
    if (webkitBackdrop && webkitBackdrop !== 'none') return true;
    const contain = style.contain || '';
    return (
      contain.includes('paint') ||
      contain.includes('layout') ||
      contain === 'strict' ||
      contain === 'content'
    );
  }

  private onDocumentClick = (event: MouseEvent): void => {
    if (!this.open()) return;
    if (this.isEventInside(event)) return;
    this.close();
  };

  private onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.open()) return;
    if (this.isEventInside(event)) return;
    this.close();
  };

  private isEventInside(event: Event): boolean {
    const path = event.composedPath();
    const host = this.hostRef.nativeElement;
    const panel = this.panelRef()?.nativeElement;
    if (path.includes(host)) return true;
    if (panel && path.includes(panel)) return true;
    return false;
  };

  private onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.open()) {
      event.preventDefault();
      this.close();
      this.triggerRef()?.nativeElement.focus();
    }
  };

  private onViewportChange = (): void => {
    if (this.open() && this.useFixedPanel()) {
      this.syncFixedPanelPosition();
    }
  };

  private listenersAttached = false;

  private addListeners(): void {
    if (this.listenersAttached) return;
    // Bubble phase so option mousedown/click runs before we treat the event as "outside".
    this.document.addEventListener('click', this.onDocumentClick, false);
    this.document.addEventListener('pointerdown', this.onDocumentPointerDown, false);
    this.document.addEventListener('keydown', this.onDocumentKeydown, true);
    window.addEventListener('resize', this.onViewportChange, { passive: true });
    window.addEventListener('scroll', this.onViewportChange, {
      capture: true,
      passive: true,
    });
    this.listenersAttached = true;
  }

  private removeListeners(): void {
    if (!this.listenersAttached) return;
    this.document.removeEventListener('click', this.onDocumentClick, false);
    this.document.removeEventListener('pointerdown', this.onDocumentPointerDown, false);
    this.document.removeEventListener('keydown', this.onDocumentKeydown, true);
    window.removeEventListener('resize', this.onViewportChange);
    window.removeEventListener('scroll', this.onViewportChange, true);
    this.listenersAttached = false;
  }
}
