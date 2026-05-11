import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { CurrentUserService } from './current-user.service';

/** ADMIN או תפ״י (PLANNING) — מסכי פרויקטים בניהול */
export const adminOrPlanningGuard: CanActivateFn = (_route, state) => {
  const auth = inject(CurrentUserService);
  const router = inject(Router);

  if (!auth.accessToken()) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }
  const role = auth.sessionUser()?.role;
  if (role !== 'ADMIN' && role !== 'PLANNING') {
    return router.createUrlTree(['/admin/planning-new']);
  }
  return true;
};
