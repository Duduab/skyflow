import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { CurrentUserService } from './current-user.service';

/** רק משתמש עם תפקיד ADMIN יכול להיכנס למסך הניהול (JWT נדרש). */
export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(CurrentUserService);
  const router = inject(Router);

  if (!auth.accessToken()) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }
  if (!auth.isAdmin()) {
    return router.createUrlTree(['/']);
  }
  return true;
};
