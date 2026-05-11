import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { CurrentUserService } from './current-user.service';

/** רק ADMIN — משתמש תפ״י מופנה לעמוד פרויקט חדש */
export const adminOnlyGuard: CanActivateFn = (_route, state) => {
  const auth = inject(CurrentUserService);
  const router = inject(Router);

  if (!auth.accessToken()) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }
  if (auth.sessionUser()?.role !== 'ADMIN') {
    return router.createUrlTree(['/admin/planning-new']);
  }
  return true;
};
