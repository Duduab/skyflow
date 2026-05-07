import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import { ProjectOrder } from '../../core/skyflow.models';
import { computeStationProgress } from '../../features/worker/station-progress';
import { OrderPickerPreview } from './order-picker.types';

export function loadOrderPickerPreviews(
  api: ApiService,
  orders: ProjectOrder[],
): Observable<Map<string, OrderPickerPreview>> {
  if (!orders.length) {
    return of(new Map());
  }
  const stationIds = [1, 2, 3, 4, 5, 6, 7];
  return forkJoin(
    orders.map((order) =>
      forkJoin(
        stationIds.map((sid) =>
          api.getWorkerContext(sid, order.id).pipe(catchError(() => of(null))),
        ),
      ).pipe(
        map((ctxs) => {
          let sum = 0;
          let complete = 0;
          for (let i = 0; i < 7; i++) {
            const ctx = ctxs[i];
            const sid = stationIds[i]!;
            const pct = ctx ? computeStationProgress(sid, ctx).percent : 0;
            sum += pct;
            if (pct >= 100) complete++;
          }
          const averagePct = Math.round(sum / 7);
          const lineDone =
            order.status === 'COMPLETED' || averagePct >= 100;
          const preview: OrderPickerPreview = {
            averagePct,
            stationsComplete: complete,
            lineDone,
          };
          return { id: order.id, preview };
        }),
      ),
    ),
  ).pipe(
    map((rows) => {
      const m = new Map<string, OrderPickerPreview>();
      for (const r of rows) {
        m.set(r.id, r.preview);
      }
      return m;
    }),
  );
}
