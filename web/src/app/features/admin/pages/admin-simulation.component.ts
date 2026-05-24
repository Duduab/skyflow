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
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { ApiService } from '../../../core/api.service';
import {
  SimulationSnapshotResponse,
  OrderSimulationRecord,
  SimulationProjectRow,
} from '../../../core/skyflow.models';
import { ThemeService } from '../../../core/theme.service';

type Scenario = 'full' | 'half' | 'extra' | 'custom';
type LineKey = 'beams' | 'glazing' | 'unitized';

export interface SimLineVm {
  key: LineKey;
  labelKey: string;
  qty: number;
  cmPerUnit: number;
  needCm: number;
  sharePct: number;
  enabled: boolean;
  coveredCm: number;
  gapCm: number;
  coveredPct: number;
}

const STORAGE_KEY = 'skyflow-order-simulations-v1';

@Component({
  selector: 'skyflow-admin-simulation',
  imports: [
    TranslateModule,
    FormsModule,
    DecimalPipe,
    DatePipe,
    RouterLink,
  ],
  templateUrl: './admin-simulation.component.html',
  styleUrl: './admin-simulation.component.scss',
})
export class AdminSimulationComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly theme = inject(ThemeService);

  readonly loading = signal(true);
  readonly snap = signal<SimulationSnapshotResponse | null>(null);

  readonly simulations = signal<OrderSimulationRecord[]>([]);
  readonly selectedSimId = signal<string | null>(null);

  readonly modalOpen = signal(false);
  readonly modalError = signal<string | null>(null);

  readonly scenario = signal<Scenario>('full');
  readonly customMult = signal(1.0);

  readonly useBeams = signal(true);
  readonly useGlazing = signal(true);
  readonly useUnitized = signal(true);
  readonly allocateBeamsFirst = signal(true);

  draftTitle = '';
  draftProjectId = '';
  draftBeams = 0;
  draftGlazing = 0;
  draftUnitized = 0;
  draftCmBeam = 600;
  draftCmGlazing = 600;
  draftCmUnitized = 600;

  readonly projectList = computed(() => this.snap()?.projects ?? []);

  readonly plantTotals = computed(() => {
    const projects = this.projectList();
    let scrapCm = 0;
    let bomNeedCm = 0;
    for (const p of projects) {
      scrapCm += p.scrapCm;
      bomNeedCm += p.needCm;
    }
    const coveragePct =
      bomNeedCm > 0 ? Math.round((scrapCm / bomNeedCm) * 1000) / 10 : 0;
    return { scrapCm, bomNeedCm, projectCount: projects.length, coveragePct };
  });

  readonly selectedSim = computed((): OrderSimulationRecord | null => {
    const id = this.selectedSimId();
    if (!id) return null;
    return this.simulations().find((s) => s.id === id) ?? null;
  });

  readonly liveProject = computed((): SimulationProjectRow | null => {
    const sel = this.selectedSim();
    if (!sel) return null;
    return (
      this.snap()?.projects.find((p) => p.projectId === sel.projectId) ?? null
    );
  });

  readonly needMult = computed(() => {
    const s = this.scenario();
    if (s === 'full') return 1;
    if (s === 'half') return 0.5;
    if (s === 'extra') return 1.15;
    return Math.max(0.01, this.customMult());
  });

  readonly adjustedNeed = computed(() => {
    const sel = this.selectedSim();
    if (!sel) return 0;
    const mult = this.needMult();
    let sum = 0;
    if (this.useBeams()) sum += sel.beamsQty * sel.cmPerBeam;
    if (this.useGlazing()) sum += sel.glazingQty * sel.cmPerGlazing;
    if (this.useUnitized()) sum += sel.unitizedQty * sel.cmPerUnitized;
    return Math.round(sum * mult);
  });

  readonly activeScrapPool = computed(() => {
    const live = this.liveProject()?.scrapCm;
    const frozen = this.selectedSim()?.scrapCmAtSave;
    return live ?? frozen ?? 0;
  });

  readonly lineBreakdown = computed((): SimLineVm[] => {
    const sel = this.selectedSim();
    if (!sel) return [];
    const mult = this.needMult();
    const lines: {
      key: LineKey;
      labelKey: string;
      qty: number;
      cm: number;
      enabled: boolean;
    }[] = [
      {
        key: 'beams',
        labelKey: 'ADMIN_SIM_PAGE.BEAMS_QTY',
        qty: sel.beamsQty,
        cm: sel.cmPerBeam,
        enabled: this.useBeams(),
      },
      {
        key: 'glazing',
        labelKey: 'ADMIN_SIM_PAGE.GLAZING_QTY',
        qty: sel.glazingQty,
        cm: sel.cmPerGlazing,
        enabled: this.useGlazing(),
      },
      {
        key: 'unitized',
        labelKey: 'ADMIN_SIM_PAGE.UNITIZED_QTY',
        qty: sel.unitizedQty,
        cm: sel.cmPerUnitized,
        enabled: this.useUnitized(),
      },
    ];
    const active = lines.filter((l) => l.enabled && l.qty > 0);
    const totalNeed = active.reduce((s, l) => s + l.qty * l.cm * mult, 0);
    let scrapLeft = this.activeScrapPool();
    const order = this.allocateBeamsFirst()
      ? active
      : [...active].sort((a, b) => b.qty * b.cm - a.qty * a.cm);

    return order.map((l) => {
      const needCm = Math.round(l.qty * l.cm * mult);
      const coveredCm = Math.round(Math.min(needCm, scrapLeft));
      scrapLeft = Math.max(0, scrapLeft - coveredCm);
      const gapCm = Math.max(0, needCm - coveredCm);
      const sharePct =
        totalNeed > 0 ? Math.round((needCm / totalNeed) * 1000) / 10 : 0;
      const coveredPct =
        needCm > 0 ? Math.round((coveredCm / needCm) * 1000) / 10 : 0;
      return {
        key: l.key,
        labelKey: l.labelKey,
        qty: l.qty,
        cmPerUnit: l.cm,
        needCm,
        sharePct,
        enabled: true,
        coveredCm,
        gapCm,
        coveredPct,
      };
    });
  });

  readonly coveredTotalCm = computed(() =>
    this.lineBreakdown().reduce((s, l) => s + l.coveredCm, 0),
  );

  readonly adjustedGap = computed(() =>
    Math.max(0, this.adjustedNeed() - this.coveredTotalCm()),
  );

  readonly coveragePct = computed(() => {
    const need = this.adjustedNeed();
    if (need <= 0) return 0;
    return Math.min(
      100,
      Math.round((this.coveredTotalCm() / need) * 1000) / 10,
    );
  });

  readonly savingsCm = computed(() => this.coveredTotalCm());

  readonly savingsPctOfNeed = computed(() => this.coveragePct());

  readonly canFullyCover = computed(
    () => this.adjustedGap() <= 0 && this.adjustedNeed() > 0,
  );

  readonly scrapDrift = computed(() => {
    const sel = this.selectedSim();
    const live = this.liveProject()?.scrapCm;
    if (!sel || live == null) return null;
    return Math.round((live - sel.scrapCmAtSave) * 10) / 10;
  });

  readonly draftPreview = computed(() => {
    const p = this.snap()?.projects.find(
      (x) => x.projectId === this.draftProjectId,
    );
    const need =
      this.draftBeams * this.draftCmBeam +
      this.draftGlazing * this.draftCmGlazing +
      this.draftUnitized * this.draftCmUnitized;
    const scrap = p?.scrapCm ?? 0;
    return {
      needCm: Math.round(need),
      scrapCm: Math.round(scrap),
      gapCm: Math.max(0, Math.round(need) - Math.round(scrap)),
      coveragePct:
        need > 0
          ? Math.min(100, Math.round((scrap / need) * 1000) / 10)
          : 0,
      projectName: p?.name ?? '',
    };
  });

  readonly scenarioOptions: { id: Scenario; labelKey: string; mult: number }[] =
    [
      { id: 'full', labelKey: 'ADMIN_SIM_PAGE.SCEN_FULL', mult: 1 },
      { id: 'half', labelKey: 'ADMIN_SIM_PAGE.SCEN_HALF', mult: 0.5 },
      { id: 'extra', labelKey: 'ADMIN_SIM_PAGE.SCEN_EXTRA', mult: 1.15 },
      { id: 'custom', labelKey: 'ADMIN_SIM_PAGE.SCEN_CUSTOM', mult: 0 },
    ];

  ngOnInit(): void {
    this.loadStored();

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

  refreshSnapshot(): void {
    this.loading.set(true);
    this.api
      .getSimulationSnapshot()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.snap.set(s);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  setScenario(v: Scenario): void {
    this.scenario.set(v);
  }

  toggleLine(key: LineKey): void {
    if (key === 'beams') this.useBeams.update((x) => !x);
    if (key === 'glazing') this.useGlazing.update((x) => !x);
    if (key === 'unitized') this.useUnitized.update((x) => !x);
  }

  isLineEnabled(key: LineKey): boolean {
    if (key === 'beams') return this.useBeams();
    if (key === 'glazing') return this.useGlazing();
    return this.useUnitized();
  }

  openNewModal(projectId?: string): void {
    this.modalError.set(null);
    const sn = this.snap();
    const pid = projectId ?? sn?.projects[0]?.projectId;
    this.draftTitle = '';
    if (pid) {
      this.applyProjectDefaults(pid);
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
    this.scenario.set('full');
    this.useBeams.set(true);
    this.useGlazing.set(true);
    this.useUnitized.set(true);
  }

  closeDetail(): void {
    this.selectedSimId.set(null);
  }

  selectProjectCard(p: SimulationProjectRow): void {
    this.openNewModal(p.projectId);
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

  projectCoveragePct(p: SimulationProjectRow): number {
    if (p.needCm <= 0) return 0;
    return Math.min(100, Math.round((p.scrapCm / p.needCm) * 1000) / 10);
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
