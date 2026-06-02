import {
  DestroyRef,
  Directive,
  ElementRef,
  effect,
  inject,
  input,
} from '@angular/core';

@Directive({
  selector: '[skyflowCountUp]',
  standalone: true,
})
export class CountUpDirective {
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  readonly value = input<number | null>(0, { alias: 'skyflowCountUp' });
  readonly suffix = input('', { alias: 'countUpSuffix' });
  readonly durationMs = input(1200, { alias: 'countUpDuration' });
  readonly decimals = input(0, { alias: 'countUpDecimals' });

  private rafId = 0;

  constructor() {
    effect(() => {
      this.animate(this.value(), this.suffix(), this.durationMs(), this.decimals());
    });

    this.destroyRef.onDestroy(() => cancelAnimationFrame(this.rafId));
  }

  private animate(
    target: number | null,
    suffix: string,
    durationMs: number,
    decimals: number,
  ): void {
    cancelAnimationFrame(this.rafId);

    if (target === null || !Number.isFinite(target)) {
      this.el.nativeElement.textContent = '—';
      return;
    }

    const start = performance.now();
    const from = 0;

    const format = (n: number): string => {
      const rounded =
        decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
      return `${rounded}${suffix}`;
    };

    const tick = (now: number): void => {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (target - from) * eased;
      this.el.nativeElement.textContent = format(current);

      if (progress < 1) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.el.nativeElement.textContent = format(target);
      }
    };

    this.el.nativeElement.textContent = format(from);
    this.rafId = requestAnimationFrame(tick);
  }
}
