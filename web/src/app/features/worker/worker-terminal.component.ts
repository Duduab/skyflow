import { DecimalPipe, DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import { UiButtonComponent } from '../../shared/ui-button.component';
import { ProjectOrder, WorkerContext } from '../../core/skyflow.models';
import { WorkerProjectSelectionService } from './worker-project-selection.service';
import {
  computeStationProgress,
  progressDashOffset as ringStrokeDashOffset,
  PROGRESS_RING_C,
  StationProgressVm,
} from './station-progress';

function allCheckedValidator(): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const g = group as FormGroup;
    if (!g.controls) return { verify: true };
    const ok = Object.values(g.controls).every((c) => c.value === true);
    return ok ? null : { verify: true };
  };
}

@Component({
  selector: 'skyflow-worker-terminal',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslateModule,
    DecimalPipe,
    UiButtonComponent,
  ],
  templateUrl: './worker-terminal.component.html',
  styleUrl: './worker-terminal.component.scss',
})
export class WorkerTerminalComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly doc = inject(DOCUMENT);
  readonly projectSelection = inject(WorkerProjectSelectionService);

  private saveToastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly doneMsg = signal(false);
  readonly saveToastVisible = signal(false);

  readonly orders = signal<ProjectOrder[]>([]);
  readonly context = signal<WorkerContext | null>(null);

  readonly progressCircumference = PROGRESS_RING_C;

  readonly managerPhotoFailed = signal(false);
  readonly uploadingDelivery = signal(false);

  stationId = 1;

  form!: FormGroup;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      if (this.saveToastTimer) {
        clearTimeout(this.saveToastTimer);
        this.saveToastTimer = null;
      }
    });

    this.route.paramMap
      .pipe(
        map((p) => Number(p.get('stationId'))),
        map((sid) => {
          if (!Number.isFinite(sid)) return 1;
          return Math.min(7, Math.max(1, sid));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((sid) => {
        this.stationId = sid;
        this.managerPhotoFailed.set(false);
        this.buildForm();
        this.tryLoadContext();
      });

    this.api
      .getOrders()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.orders.set(list);
          this.projectSelection.syncFromOrders(list);
          this.tryLoadContext();
        },
        error: () =>
          this.error.set('לא ניתן לטעון הזמנות — בדוק חיבור לשרת'),
      });
  }

  onOrderChange(id: string): void {
    this.projectSelection.select(id);
    this.tryLoadContext();
  }

  stationProgress(ctx: WorkerContext): StationProgressVm {
    return computeStationProgress(this.stationId, ctx);
  }

  managerAvatarSrc(): string {
    const ctx = this.context();
    const u = ctx?.stationManagerDisplay?.photoUrl?.trim();
    if (u?.length) return u;
    return `/assets/managers/${this.stationId}.jpg`;
  }

  onManagerPhotoError(): void {
    this.managerPhotoFailed.set(true);
  }

  progressDashOffset(percent: number): number {
    return ringStrokeDashOffset(percent);
  }

  async onDeliveryFileSelected(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const pid = this.projectSelection.selectedProjectId();
    if (!file || !pid || this.stationId !== 7) return;
    this.uploadingDelivery.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.postSiteDeliveryNote(pid, file));
      this.tryLoadContext();
      this.showSaveToast();
    } catch {
      this.error.set('העלאת תעודת משלוח נכשלה');
    } finally {
      this.uploadingDelivery.set(false);
      input.value = '';
    }
  }

  private scrollToProgress(): void {
    const prefersReduced =
      typeof this.doc.defaultView?.matchMedia === 'function' &&
      this.doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)')
        .matches;
    queueMicrotask(() => {
      this.doc
        .getElementById('station-progress-panel')
        ?.scrollIntoView({
          behavior: prefersReduced ? 'auto' : 'smooth',
          block: 'start',
        });
    });
  }

  private showSaveToast(): void {
    if (this.saveToastTimer) {
      clearTimeout(this.saveToastTimer);
      this.saveToastTimer = null;
    }
    this.saveToastVisible.set(true);
    this.saveToastTimer = setTimeout(() => {
      this.saveToastVisible.set(false);
      this.saveToastTimer = null;
    }, 4200);
  }

  scrapCm(): number {
    const ctx = this.context();
    if (!ctx || this.stationId !== 1 || !this.form) return 0;
    const target = ctx.order.totalItems;
    const orig = Number(ctx.order.originalLength);
    const pq = Number(this.form.get('barsQty')?.value ?? 0);
    const meters = Number(this.form.get('metersPerBar')?.value ?? 0);
    const cl = meters * 100;
    if (!target || !orig || !cl) return 0;
    return Math.max(0, target * orig - pq * cl);
  }

  private tryLoadContext(): void {
    const pid = this.projectSelection.selectedProjectId();
    if (
      !pid ||
      !this.stationId ||
      this.stationId < 1 ||
      this.stationId > 7
    ) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.doneMsg.set(false);
    this.api
      .getWorkerContext(this.stationId, pid)
      .subscribe({
        next: (ctx) => {
          this.context.set(ctx);
          this.managerPhotoFailed.set(false);
          this.loading.set(false);
          if (
            this.stationId === 6 &&
            ctx.packedQty >= ctx.requiredPackQty
          ) {
            this.doneMsg.set(true);
          }
          if (this.stationId === 7) {
            const pct = this.stationProgress(ctx).percent;
            this.doneMsg.set(pct >= 100);
            const sa = ctx.siteAssembly;
            if (sa && this.form?.get('assembledBeams')) {
              this.form.patchValue({
                assembledBeams: sa.assembledBeams,
                assembledGlazing: sa.assembledGlazing,
                assembledUnitized: sa.assembledUnitized,
              });
            }
          }
        },
        error: () => {
          this.loading.set(false);
          this.error.set('שגיאה בטעינת העמדה — נסה שוב');
        },
      });
  }

  private buildForm(): void {
    const sid = this.stationId;
    if (sid === 5) {
      const checks = this.fb.group(
        {
          s1: new FormControl(false, { nonNullable: true }),
          s2: new FormControl(false, { nonNullable: true }),
          s3: new FormControl(false, { nonNullable: true }),
          s4: new FormControl(false, { nonNullable: true }),
        },
        { validators: allCheckedValidator() },
      );
      this.form = this.fb.group({
        checks,
      });
      return;
    }

    const base = {
      issues: [''],
    };

    switch (sid) {
      case 1:
        this.form = this.fb.group({
          ...base,
          barsQty: [0, [Validators.required, Validators.min(1)]],
          metersPerBar: [6, [Validators.required, Validators.min(0.01)]],
        });
        break;
      case 2:
        this.form = this.fb.group({
          ...base,
          processedQty: [0, [Validators.required, Validators.min(0)]],
        });
        break;
      case 3:
        this.form = this.fb.group({
          ...base,
          usedQty: [0, [Validators.required, Validators.min(0)]],
          scrapQty: [0, [Validators.min(0)]],
          scrapLength: [0, [Validators.min(0)]],
        });
        break;
      case 4:
        this.form = this.fb.group({
          ...base,
          gluedQty: [0, [Validators.required, Validators.min(0)]],
          scrapQty: [0, [Validators.min(0)]],
          scrapLength: [0, [Validators.min(0)]],
        });
        break;
      case 6:
        this.form = this.fb.group({
          ...base,
          packedQty: [0, [Validators.required, Validators.min(0)]],
          scrapQty: [0, [Validators.min(0)]],
          scrapLength: [0, [Validators.min(0)]],
        });
        break;
      case 7:
        this.form = this.fb.group({
          ...base,
          assembledBeams: [
            0,
            [Validators.required, Validators.min(0)],
          ],
          assembledGlazing: [
            0,
            [Validators.required, Validators.min(0)],
          ],
          assembledUnitized: [
            0,
            [Validators.required, Validators.min(0)],
          ],
        });
        break;
      default:
        this.form = this.fb.group({ ...base });
    }
  }

  async submit(): Promise<void> {
    const pid = this.projectSelection.selectedProjectId();
    if (!this.form || !pid || this.form.invalid) {
      this.form?.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const sid = this.stationId;
    this.saving.set(true);
    this.error.set(null);

    let processedQty = 0;
    let extraPayload: Record<string, unknown> | undefined;

    if (sid === 1) {
      processedQty = Number(raw['barsQty']);
    } else if (sid === 2) {
      processedQty = Number(raw['processedQty']);
    } else if (sid === 3) {
      processedQty = Number(raw['usedQty']);
    } else if (sid === 4) {
      processedQty = Number(raw['gluedQty']);
    } else if (sid === 5) {
      processedQty = 1;
      extraPayload = { finishingChecks: raw['checks'] };
    } else if (sid === 6) {
      processedQty = Number(raw['packedQty']);
    } else if (sid === 7) {
      processedQty = 1;
      extraPayload = {
        assembledBeams: Number(raw['assembledBeams']),
        assembledGlazing: Number(raw['assembledGlazing']),
        assembledUnitized: Number(raw['assembledUnitized']),
      };
    }

    const logBody: Record<string, unknown> = {
      projectId: pid,
      processedQty,
      issues: raw['issues'] || undefined,
    };

    if (sid === 1) {
      const meters = Number(raw['metersPerBar']);
      logBody['cutLength'] = Math.round(meters * 100);
    }
    if (extraPayload) {
      logBody['extraPayload'] = extraPayload;
    }

    const scrapQty = Number(raw['scrapQty'] ?? 0);
    const scrapLen = Number(raw['scrapLength'] ?? 0);

    try {
      if (sid === 1) {
        const auto = this.scrapCm();
        if (auto > 0) {
          await firstValueFrom(
            this.api.postScrap(1, {
              projectId: pid,
              scrapQty: 1,
              itemLength: auto,
            }),
          );
        }
      }

      if ([3, 4, 6].includes(sid) && scrapQty > 0 && scrapLen > 0) {
        await firstValueFrom(
          this.api.postScrap(sid, {
            projectId: pid,
            scrapQty,
            itemLength: scrapLen,
          }),
        );
      }

      await firstValueFrom(this.api.postStationLog(sid, logBody));

      const ctx = await firstValueFrom(
        this.api.getWorkerContext(sid, pid),
      );
      this.context.set(ctx);
      if (sid === 6 && ctx.packedQty >= ctx.requiredPackQty) {
        this.doneMsg.set(true);
      }
      if (sid === 7 && this.stationProgress(ctx).percent >= 100) {
        this.doneMsg.set(true);
      }
      this.scrollToProgress();
      this.showSaveToast();
    } catch {
      this.error.set('שמירה נכשלה');
    } finally {
      this.saving.set(false);
    }
  }
}
