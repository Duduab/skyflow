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
import { firstValueFrom } from 'rxjs';
import { UiButtonComponent } from '../../../shared/ui-button.component';
import { UiPopupComponent } from '../../../shared/ui-popup/ui-popup.component';
import { TranslateModule } from '@ngx-translate/core';

import { ApiService } from '../../../core/api.service';
import {
  SimulationSnapshotResponse,
  OrderSimulationRecord,
  SimulationProjectRow,
  SimProfileNeedLine,
  ProfileInventoryRow,
} from '../../../core/skyflow.models';
import {
  CATALOG_PROFILE_CODES,
  evaluateProfileSimulation,
  ProfileKind,
  SimProfileNeedResult,
  isCatalogProfileCode,
  normalizeProfileCode,
} from '../../../core/profile-inventory.util';
import { ThemeService } from '../../../core/theme.service';

const STORAGE_KEY = 'skyflow-order-simulations-v3';
const LEGACY_STORAGE_KEYS = [
  'skyflow-order-simulations-v2',
  'skyflow-order-simulations-v1',
];

interface DraftNeedRow {
  profileKind: ProfileKind;
  profileCode: string;
  qty: number;
  lengthMm: number;
}

@Component({
  selector: 'skyflow-admin-simulation',
  imports: [
    TranslateModule,
    FormsModule,
    DecimalPipe,
    DatePipe,
    RouterLink,
    UiButtonComponent,
    UiPopupComponent,
  ],
  templateUrl: './admin-simulation.component.html',
  styleUrl: './admin-simulation.component.scss',
})
export class AdminSimulationComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly theme = inject(ThemeService);

  readonly catalogCodes = CATALOG_PROFILE_CODES;

  readonly loading = signal(true);
  readonly snap = signal<SimulationSnapshotResponse | null>(null);

  readonly simulations = signal<OrderSimulationRecord[]>([]);
  readonly selectedSimId = signal<string | null>(null);

  readonly modalOpen = signal(false);
  readonly searchModalOpen = signal(false);
  readonly searchRefreshing = signal(false);
  readonly modalError = signal<string | null>(null);

  draftTitle = '';
  draftScrapProjectId = '';
  draftNeedRows: DraftNeedRow[] = [this.emptyNeedRow()];

  readonly projectList = computed(() => this.snap()?.projects ?? []);

  readonly selectedSim = computed((): OrderSimulationRecord | null => {
    const id = this.selectedSimId();
    if (!id) return null;
    return this.simulations().find((s) => s.id === id) ?? null;
  });

  readonly liveInventory = computed((): ProfileInventoryRow[] => {
    const sel = this.selectedSim();
    if (!sel) return [];
    return (
      this.snap()?.projects.find(
        (p) => p.projectId === sel.scrapSourceProjectId,
      )?.profileInventory ?? sel.inventoryAtSave
    );
  });

  readonly evaluation = computed(() => {
    const sel = this.selectedSim();
    if (!sel) return null;
    return evaluateProfileSimulation(this.liveInventory(), sel.needLines);
  });

  readonly canFullyCover = computed(() => this.evaluation()?.enough ?? false);

  readonly plantTotals = computed(() => {
    const projects = this.projectList();
    const scrapMm = projects.reduce((s, p) => s + p.scrapMm, 0);
    const profilePieces = projects.reduce(
      (s, p) => s + p.profileInventory.reduce((a, r) => a + r.qty, 0),
      0,
    );
    return {
      scrapMm,
      projectCount: projects.filter((p) => p.profileInventory.length > 0).length,
      profilePieces,
    };
  });

  detailCoveragePct(): number {
    const ev = this.evaluation();
    if (!ev || ev.totalNeedMm <= 0) return 0;
    return Math.min(
      100,
      Math.round((ev.totalCoveredMm / ev.totalNeedMm) * 100),
    );
  }

  readonly scrapDrift = computed(() => {
    const sel = this.selectedSim();
    if (!sel) return null;
    const liveMm =
      this.snap()?.projects.find(
        (p) => p.projectId === sel.scrapSourceProjectId,
      )?.scrapMm ?? null;
    if (liveMm == null) return null;
    const savedMm = sel.inventoryAtSave.reduce((s, r) => s + r.totalMm, 0);
    return Math.round((liveMm - savedMm) * 10) / 10;
  });

  readonly draftPreview = computed(() => {
    const inv =
      this.snap()?.projects.find(
        (p) => p.projectId === this.draftScrapProjectId,
      )?.profileInventory ?? [];
    const needs = this.draftNeedRows
      .filter((r) => r.qty > 0 && r.lengthMm > 0)
      .map((r) => ({
        profileKind: r.profileKind,
        profileCode: normalizeProfileCode(r.profileCode),
        qty: r.qty,
        lengthMm: r.lengthMm,
      }));
    return evaluateProfileSimulation(inv, needs);
  });

  readonly draftScrapProjectName = computed(() => {
    const id = this.draftScrapProjectId;
    if (!id) return '';
    return this.snap()?.projects.find((p) => p.projectId === id)?.name ?? '';
  });

  readonly draftScrapInventory = computed((): ProfileInventoryRow[] => {
    const id = this.draftScrapProjectId;
    if (!id) return [];
    return (
      this.snap()?.projects.find((p) => p.projectId === id)?.profileInventory ??
      []
    );
  });

  ngOnInit(): void {
    this.loadStored();
    this.api
      .getSimulationSnapshot()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.snap.set(s);
          if (!this.draftScrapProjectId && s.projects[0]) {
            this.draftScrapProjectId = s.projects[0].projectId;
            this.resetDraftRows(s.projects[0]);
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

  openNewModal(projectId?: string): void {
    this.modalError.set(null);
    const pid = projectId ?? this.snap()?.projects[0]?.projectId;
    this.draftTitle = '';
    if (pid) {
      this.draftScrapProjectId = pid;
      const row = this.snap()?.projects.find((p) => p.projectId === pid);
      if (row) this.resetDraftRows(row);
    } else {
      this.draftScrapProjectId = '';
      this.draftNeedRows = [this.emptyNeedRow()];
    }
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.searchModalOpen.set(false);
    this.modalError.set(null);
  }

  async openDraftSearch(): Promise<void> {
    this.modalError.set(null);
    if (!this.draftScrapProjectId) {
      this.modalError.set('ADMIN_SIM_PAGE.ERR_PROJECT');
      return;
    }
    const hasNeed = this.draftNeedRows.some((r) => r.qty > 0 && r.lengthMm > 0);
    if (!hasNeed) {
      this.modalError.set('ADMIN_SIM_PAGE.ERR_SEARCH_NEED');
      return;
    }
    this.searchRefreshing.set(true);
    try {
      const s = await firstValueFrom(this.api.getSimulationSnapshot());
      this.snap.set(s);
      this.searchModalOpen.set(true);
    } catch {
      this.modalError.set('ADMIN_SIM_PAGE.ERR_SEARCH_REFRESH');
    } finally {
      this.searchRefreshing.set(false);
    }
  }

  closeSearchModal(): void {
    this.searchModalOpen.set(false);
  }

  onDraftScrapProjectChange(projectId: string): void {
    this.draftScrapProjectId = projectId;
    const row = this.snap()?.projects.find((p) => p.projectId === projectId);
    if (row) this.resetDraftRows(row);
  }

  addDraftRow(): void {
    this.draftNeedRows = [...this.draftNeedRows, this.emptyNeedRow()];
  }

  removeDraftRow(index: number): void {
    if (this.draftNeedRows.length <= 1) return;
    this.draftNeedRows = this.draftNeedRows.filter((_, i) => i !== index);
  }

  onDraftProfileKindChange(row: DraftNeedRow, kind: ProfileKind): void {
    row.profileKind = kind;
    if (kind === 'CATALOG' && !isCatalogProfileCode(row.profileCode)) {
      row.profileCode = 'MPS-X';
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
      (x) => x.projectId === this.draftScrapProjectId,
    );
    if (!p) {
      this.modalError.set('ADMIN_SIM_PAGE.ERR_PROJECT');
      return;
    }

    const needLines: SimProfileNeedLine[] = this.draftNeedRows
      .filter((r) => r.qty > 0 && r.lengthMm > 0)
      .map((r) => ({
        profileKind: r.profileKind,
        profileCode: normalizeProfileCode(r.profileCode),
        qty: Math.floor(r.qty),
        lengthMm: Math.round(r.lengthMm),
      }));

    if (needLines.length === 0) {
      this.modalError.set('ADMIN_SIM_PAGE.ERR_NEED_LINE');
      return;
    }

    const evalResult = evaluateProfileSimulation(p.profileInventory, needLines);

    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sim-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const rec: OrderSimulationRecord = {
      id,
      title,
      createdAt: new Date().toISOString(),
      scrapSourceProjectId: p.projectId,
      scrapSourceProjectName: p.name,
      needLines,
      inventoryAtSave: p.profileInventory.map((r) => ({ ...r })),
      totalNeedMm: evalResult.totalNeedMm,
      totalCoveredMm: evalResult.totalCoveredMm,
      totalGapMm: evalResult.totalGapMm,
    };

    this.simulations.update((list) => [rec, ...list]);
    this.persist();
    this.selectedSimId.set(rec.id);
    this.closeModal();
  }

  selectSim(id: string): void {
    this.selectedSimId.set(id);
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

  profileLabel(code: string): string {
    return normalizeProfileCode(code);
  }

  /** אותו אורך, פרופיל אחר — למשל חיפש MPS-Y ויש MPB-Y */
  similarInventoryForLine(line: SimProfileNeedResult): ProfileInventoryRow[] {
    const code = normalizeProfileCode(line.profileCode);
    return this.draftScrapInventory().filter(
      (b) => b.lengthMm === line.lengthMm && b.profileCode !== code && b.qty > 0,
    );
  }

  /** אותו פרופיל, אורך אחר */
  sameProfileOtherLengths(line: SimProfileNeedResult): ProfileInventoryRow[] {
    const code = normalizeProfileCode(line.profileCode);
    return this.draftScrapInventory().filter(
      (b) => b.profileCode === code && b.lengthMm !== line.lengthMm && b.qty > 0,
    );
  }

  applyInventoryToFirstRow(bucket: ProfileInventoryRow): void {
    const row = this.draftNeedRows[0];
    if (!row) return;
    row.profileKind = bucket.profileKind;
    row.profileCode = bucket.profileCode;
    row.lengthMm = bucket.lengthMm;
    if (!row.qty || row.qty <= 0) {
      row.qty = 1;
    }
    this.closeSearchModal();
  }

  private emptyNeedRow(): DraftNeedRow {
    return {
      profileKind: 'CATALOG',
      profileCode: 'MPS-X',
      qty: 0,
      lengthMm: 6000,
    };
  }

  private resetDraftRows(p: SimulationProjectRow): void {
    this.draftNeedRows = [
      {
        profileKind: 'CATALOG',
        profileCode: 'MPS-X',
        qty: 0,
        lengthMm: Math.round(p.originalLengthMm) || 6000,
      },
    ];
  }

  private loadStored(): void {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        for (const legacy of LEGACY_STORAGE_KEYS) {
          raw = localStorage.getItem(legacy);
          if (raw) break;
        }
        if (!raw) return;
      }
      const j = JSON.parse(raw) as unknown;
      if (!Array.isArray(j)) return;
      const ok: OrderSimulationRecord[] = [];
      for (const r of j) {
        const rec = this.normalizeStoredRecord(r);
        if (rec) ok.push(rec);
      }
      this.simulations.set(ok);
      if (raw !== localStorage.getItem(STORAGE_KEY)) {
        this.persist();
        for (const legacy of LEGACY_STORAGE_KEYS) {
          localStorage.removeItem(legacy);
        }
      }
    } catch {
      /* ignore */
    }
  }

  private normalizeStoredRecord(r: unknown): OrderSimulationRecord | null {
    if (!r || typeof r !== 'object') return null;
    const o = r as Record<string, unknown>;
    if (typeof o['id'] !== 'string' || typeof o['title'] !== 'string') {
      return null;
    }
    if (Array.isArray(o['needLines'])) {
      const needLines: SimProfileNeedLine[] = [];
      for (const line of o['needLines'] as unknown[]) {
        if (!line || typeof line !== 'object') continue;
        const l = line as Record<string, unknown>;
        const qty = Number(l['qty']);
        const lengthMm = Number(l['lengthMm']);
        if (!Number.isFinite(qty) || !Number.isFinite(lengthMm)) continue;
        needLines.push({
          profileKind: l['profileKind'] === 'DRAWN' ? 'DRAWN' : 'CATALOG',
          profileCode: normalizeProfileCode(String(l['profileCode'] ?? '')),
          qty: Math.floor(qty),
          lengthMm: Math.round(lengthMm),
        });
      }
      if (!needLines.length) return null;
      const inv = Array.isArray(o['inventoryAtSave'])
        ? (o['inventoryAtSave'] as ProfileInventoryRow[])
        : [];
      const evalResult = evaluateProfileSimulation(inv, needLines);
      return {
        id: o['id'] as string,
        title: o['title'] as string,
        createdAt:
          typeof o['createdAt'] === 'string'
            ? o['createdAt']
            : new Date().toISOString(),
        scrapSourceProjectId: String(o['scrapSourceProjectId'] ?? ''),
        scrapSourceProjectName: String(o['scrapSourceProjectName'] ?? ''),
        needLines,
        inventoryAtSave: inv,
        totalNeedMm: evalResult.totalNeedMm,
        totalCoveredMm: evalResult.totalCoveredMm,
        totalGapMm: evalResult.totalGapMm,
      };
    }
    return null;
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.simulations()));
    } catch {
      /* ignore */
    }
  }
}
