import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';
import { Params, Router } from '@angular/router';

import { UiCardActionColor } from './ui-card-action.types';

/**
 * Quick action for admin cards — full-width tinted button; pass `color` only.
 * Link: `[routerLink]` / `[href]`. Button: omit both and listen to `(action)`.
 */
@Component({
  selector: 'skyflow-ui-card-action',
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `
    @if (hasLink()) {
      <a
        [class]="rootClass()"
        [href]="resolvedHref()"
        [attr.target]="target() ?? null"
        [attr.rel]="linkRel()"
        [attr.aria-disabled]="disabled() ? true : null"
        [attr.tabindex]="disabled() ? -1 : null"
        (click)="onLinkClick($event)"
      >
        <ng-container *ngTemplateOutlet="inner" />
      </a>
    } @else {
      <button
        [class]="rootClass()"
        [attr.type]="type()"
        [disabled]="disabled()"
        (click)="onAction($event)"
      >
        <ng-container *ngTemplateOutlet="inner" />
      </button>
    }

    <ng-template #inner>
      <span class="sf-ui-card-action__inner"><ng-content /></span>
    </ng-template>
  `,
  styleUrl: './ui-card-action.component.scss',
  host: {
    '[class.sf-ui-card-action-host--block]': 'block()',
    '[class.sf-ui-card-action-host--push]': 'pushBottom()',
  },
})
export class UiCardActionComponent {
  private readonly router = inject(Router);

  /** Preset tint — blue | purple | primary | red | green */
  readonly color = input<UiCardActionColor>('blue');
  readonly routerLink = input<string | readonly unknown[] | null>(null);
  readonly queryParams = input<Params | null>(null);
  readonly href = input<string | null>(null);
  readonly target = input<'_blank' | '_self' | '_parent' | '_top' | null>(null);
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly disabled = input(false);
  /** Pin to card footer (margin-top: auto). */
  readonly pushBottom = input(true);
  readonly block = input(true);

  readonly action = output<MouseEvent>();

  readonly hasRouterLink = computed(() => this.routerLink() != null);

  readonly hasLink = computed(
    () => this.hasRouterLink() || (this.href() != null && this.href() !== ''),
  );

  readonly resolvedHref = computed(() => {
    if (this.hasRouterLink()) {
      return this.router.serializeUrl(this.urlTree());
    }
    return this.href() ?? '#';
  });

  readonly colorClass = computed(() => `sf-ui-card-action--${this.color()}`);

  readonly rootClass = computed(() => `sf-ui-card-action ${this.colorClass()}`);

  readonly linkRel = computed(() => {
    const t = this.target();
    if (t === '_blank') return 'noopener noreferrer';
    return null;
  });

  onLinkClick(event: MouseEvent): void {
    if (this.disabled()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!this.hasRouterLink()) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || this.target() === '_blank') {
      return;
    }

    event.preventDefault();
    void this.router.navigateByUrl(this.urlTree());
  }

  onAction(event: MouseEvent): void {
    if (this.disabled()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.action.emit(event);
  }

  private urlTree() {
    const link = this.routerLink()!;
    return this.router.createUrlTree(Array.isArray(link) ? link : [link], {
      queryParams: this.queryParams() ?? undefined,
    });
  }
}
