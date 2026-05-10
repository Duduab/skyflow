import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { ApiService } from '../../core/api.service';
import { WorkerContext } from '../../core/skyflow.models';
import { WorkerProjectSelectionService } from './worker-project-selection.service';
import { computeStationProgress } from './station-progress';

/**
 * Blocks deep links to a station until all previous stations reached 100%
 * (same rules as the worker hub). Station 1 requires approved planning.
 */
export const stationSequenceGuard: CanActivateFn = (route) => {
  const api = inject(ApiService);
  const router = inject(Router);
  const projectSelection = inject(WorkerProjectSelectionService);

  const sidRaw = route.paramMap.get('stationId');
  const stationId = Number(sidRaw);
  if (!Number.isFinite(stationId) || stationId < 1 || stationId > 7) {
    return router.parseUrl('/worker');
  }
  if (stationId === 1) {
    return api.getOrders().pipe(
      switchMap((orders) => {
        if (!orders.length) {
          return of(router.parseUrl('/worker'));
        }
        projectSelection.syncFromOrders(orders);
        const projectId = projectSelection.selectedProjectId();
        if (!projectId) {
          return of(router.parseUrl('/worker'));
        }
        return api.getWorkerContext(1, projectId).pipe(
          map((ctx) => {
            if (ctx.order.flowStatus === 'PENDING_PLANNING') {
              return router.parseUrl('/worker');
            }
            return true;
          }),
          catchError(() => of(router.parseUrl('/worker'))),
        );
      }),
    );
  }

  return api.getOrders().pipe(
    switchMap((orders) => {
      if (!orders.length) {
        return of(router.parseUrl('/worker'));
      }
      projectSelection.syncFromOrders(orders);
      const projectId = projectSelection.selectedProjectId();
      if (!projectId) {
        return of(router.parseUrl('/worker'));
      }
      const prevIds = Array.from({ length: stationId - 1 }, (_, i) => i + 1);
      return forkJoin(
        prevIds.map((id) =>
          api.getWorkerContext(id, projectId).pipe(
            catchError(() => of(null as WorkerContext | null)),
          ),
        ),
      ).pipe(
        map((ctxs) => {
          for (let i = 0; i < ctxs.length; i++) {
            const ctx = ctxs[i];
            const prevSid = prevIds[i];
            if (!ctx) {
              return router.parseUrl('/worker');
            }
            if (computeStationProgress(prevSid, ctx).percent < 100) {
              return router.parseUrl('/worker');
            }
          }
          return true;
        }),
      );
    }),
  );
};
