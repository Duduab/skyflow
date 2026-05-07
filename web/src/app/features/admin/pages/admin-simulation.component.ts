import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { ApiService } from '../../../core/api.service';
import {
  SimulationSnapshotResponse,
  OrderSimulationRecord,
} from '../../../core/skyflow.models';
import { ThemeService } from '../../../core/theme.service';

type Scenario = 'full' | 'half' | 'extra' | 'custom';

const STORAGE_KEY = 'skyflow-order-simulations-v1';

@Component({
  selector: 'skyflow-admin-simulation',
  imports: [TranslateModule, FormsModule, DecimalPipe, DatePipe],
  templateUrl: './admin-simulation.component.html',
  styleUrl: './admin-simulation.component.scss',
})
export class AdminSimulationComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly theme = inject(ThemeService);

  readonly loading = signal(true);
  readonly snap = signal<SimulationSnapshotResponse | null>(null);

  /** סימולציות שמורות בדפדפן */
  readonly simulations = signal<OrderSimulationRecord[]>([]);
  readonly selectedSimId = signal<string | null>(null);

  readonly modalOpen = signal(false);
  readonly modalError = signal<string | null>(null);

  readonly scenario = signal<Scenario>('full');
  readonly customMult = signal(1.0);

  draftTitle = '';
  draftProjectId = '';
  draftBeams = 0;
  draftGlazing = 0;
  draftUnitized = 0;
  draftCmBeam = 600;
  draftCmGlazing = 600;
  draftCmUnitized = 600;

  readonly projectList = computed(() => this.snap()?.projects ?? []);

  readonly selectedSim = computed((): OrderSimulationRecord | null => {
    const id = this.selectedSimId();
    if (!id) return null;
    return this.simulations().find((s) => s.id === id) ?? null;
  });

  readonly needMult = computed(() => {
    const s = this.scenario();
    if (s === 'full') return 1;
    if (s === 'half') return 0.5;
    if (s === 'extra') return 1.15;
    return Math.max(0.01, this.customMult());
  });

  readonly adjustedNeed = computed(() => {
    const row = this.selectedSim();
    if (!row) return 0;
    return Math.round(row.baseNeedCm * this.needMult());
  });

  readonly adjustedGap = computed(() => {
    const row = this.selectedSim();
    if (!row) return 0;
    return Math.max(0, this.adjustedNeed() - row.scrapCmAtSave);
  });

  ngOnInit(): void {
    this.loadStored();
    const first = this.simulations()[0]?.id ?? null;
    if (first) this.selectedSimId.set(first);

    this.api
      .getSimulationSnapshot()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.snap.set(s);
          if (!this.draftProjectId && s.projects[0]) {
            this.applyProjectDefaults(s.projects[0].projectId);
          }
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  setScenario(v: string): void {
    if (v === 'full' || v === 'half' || v === 'extra' || v === 'custom') {
      this.scenario.set(v);
    }
  }

  openNewModal(): void {
    this.modalError.set(null);
    const sn = this.snap();
    const first = sn?.projects[0];
    this.draftTitle = '';
    if (first) {
      this.applyProjectDefaults(first.projectId);
    } else {
      this.draftProjectId = '';
      this.draftBeams = 0;
      this.draftGlazing = 0;
      this.draftUnitized = 0;
    }
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.modalError.set(null);
  }

  onDraftProjectChange(projectId: string): void {
    this.draftProjectId = projectId;
    const row = this.snap()?.projects.find((p) => p.projectId === projectId);
    if (row) {
      const L = row.originalLengthCm;
      this.draftCmBeam = L;
      this.draftCmGlazing = L;
      this.draftCmUnitized = L;
    }
  }

  saveSimulation(): void {
    this.modalError.set(null);
    const title = this.draftTitle.trim();
    if (!title) {
      this.modalError.set('ADMIN_SIM_PAGE.ERR_TITLE');
      return;
    }
    const p = this.snap()?.projects.find(
      (x) => x.projectId === this.draftProjectId,
    );
    if (!p) {
      this.modalError.set('ADMIN_SIM_PAGE.ERR_PROJECT');
      return;
    }

    const baseNeedCm =
      this.draftBeams * this.draftCmBeam +
      this.draftGlazing * this.draftCmGlazing +
      this.draftUnitized * this.draftCmUnitized;

    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sim-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const rec: OrderSimulationRecord = {
      id,
      title,
      createdAt: new Date().toISOString(),
      projectId: p.projectId,
      projectName: p.name,
      beamsQty: this.draftBeams,
      glazingQty: this.draftGlazing,
      unitizedQty: this.draftUnitized,
      cmPerBeam: this.draftCmBeam,
      cmPerGlazing: this.draftCmGlazing,
      cmPerUnitized: this.draftCmUnitized,
      baseNeedCm: Math.round(baseNeedCm * 100) / 100,
      scrapCmAtSave: Math.round(p.scrapCm * 100) / 100,
    };

    this.simulations.update((list) => [rec, ...list]);
    this.persist();
    this.selectedSimId.set(rec.id);
    this.closeModal();
  }

  selectSim(id: string): void {
    this.selectedSimId.set(id);
  }

  deleteSim(id: string, ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.simulations.update((list) => list.filter((s) => s.id !== id));
    this.persist();
    if (this.selectedSimId() === id) {
      this.selectedSimId.set(this.simulations()[0]?.id ?? null);
    }
  }

  private applyProjectDefaults(projectId: string): void {
    this.draftProjectId = projectId;
    const row = this.snap()?.projects.find((p) => p.projectId === projectId);
    const L = row?.originalLengthCm ?? 600;
    this.draftCmBeam = L;
    this.draftCmGlazing = L;
    this.draftCmUnitized = L;
    this.draftBeams = 0;
    this.draftGlazing = 0;
    this.draftUnitized = 0;
  }

  private loadStored(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as OrderSimulationRecord[];
      if (Array.isArray(j)) {
        const ok = j.filter(
          (r) =>
            r &&
            typeof r.id === 'string' &&
            typeof r.title === 'string' &&
            typeof r.baseNeedCm === 'number' &&
            typeof r.scrapCmAtSave === 'number',
        );
        this.simulations.set(ok);
      }
    } catch {
      /* ignore */
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(this.simulations()),
      );
    } catch {
      /* ignore */
    }
  }
}
