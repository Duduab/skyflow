import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { CurrentUserService } from './current-user.service';

/** דורש JWT + משתמש בזיכרון — לפני דף הבית / פרופיל וכו׳ */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(CurrentUserService);
  const router = inject(Router);
  if (auth.accessToken() && auth.sessionUser()) {
    return true;
  }
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
};
