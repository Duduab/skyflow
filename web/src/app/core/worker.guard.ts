import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { CurrentUserService } from './current-user.service';

const WORKER_ROUTE_ROLES = new Set([
  'WORKER',
  'STATION_MANAGER',
  'SITE_MANAGER',
  'ADMIN',
  'PLANNING',
]);

/** עמדות עבודה — דורש התחברות ותפקיד קו / ניהול / תפ״י */
export const workerGuard: CanActivateFn = (_route, state) => {
  const auth = inject(CurrentUserService);
  const router = inject(Router);

  if (!auth.accessToken()) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }
  const role = auth.sessionUser()?.role;
  if (!role || !WORKER_ROUTE_ROLES.has(role)) {
    return router.createUrlTree(['/']);
  }
  return true;
};
