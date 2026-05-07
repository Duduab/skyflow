import { Injectable, signal } from '@angular/core';

import { ProjectOrder } from '../../core/skyflow.models';

/**
 * פרויקט נבחר משותף ל־Hub ולטרמינל העמדה + ל־stationSequenceGuard.
 */
@Injectable({ providedIn: 'root' })
export class WorkerProjectSelectionService {
  readonly selectedProjectId = signal<string | null>(null);

  /** אם אין בחירה או שהפרויקט לא ברשימה — בוחר את הראשון (לפי סדר ה־API). */
  syncFromOrders(orders: ProjectOrder[]): void {
    if (!orders.length) {
      this.selectedProjectId.set(null);
      return;
    }
    const cur = this.selectedProjectId();
    if (!cur || !orders.some((o) => o.id === cur)) {
      this.selectedProjectId.set(orders[0].id);
    }
  }

  select(id: string): void {
    this.selectedProjectId.set(id);
  }
}
