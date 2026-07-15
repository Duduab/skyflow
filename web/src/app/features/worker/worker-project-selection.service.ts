import { Injectable, signal } from '@angular/core';

import { ProjectOrder } from '../../core/skyflow.models';

/**
 * פרויקט נבחר משותף ל־Hub ולטרמינל העמדה + ל־stationSequenceGuard.
 */
@Injectable({ providedIn: 'root' })
export class WorkerProjectSelectionService {
  readonly selectedProjectId = signal<string | null>(null);
  /** סבב העבודה (יחידה, למשל 74-1-03A) שנבחר ב-Hub ומשותף לטרמינל. */
  readonly selectedCycleId = signal<string | null>(null);

  /** אם אין בחירה או שהפרויקט לא ברשימה — בוחר את הראשון (לפי סדר ה־API). */
  syncFromOrders(orders: ProjectOrder[]): void {
    if (!orders.length) {
      this.selectedProjectId.set(null);
      this.selectedCycleId.set(null);
      return;
    }
    const cur = this.selectedProjectId();
    if (!cur || !orders.some((o) => o.id === cur)) {
      this.selectedProjectId.set(orders[0].id);
      this.selectedCycleId.set(null);
    }
  }

  select(id: string): void {
    if (this.selectedProjectId() !== id) {
      // Switching project invalidates the previously selected unit.
      this.selectedCycleId.set(null);
    }
    this.selectedProjectId.set(id);
  }

  selectCycle(cycleId: string | null): void {
    this.selectedCycleId.set(cycleId);
  }
}
