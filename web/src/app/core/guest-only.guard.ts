import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { CurrentUserService } from './current-user.service';

/** דף לוגין בלבד — אם כבר מחוברים, חזרה לדף הבית (שם יוצגו הפעולות לפי תפקיד) */
export const guestOnlyGuard: CanActivateFn = () => {
  const auth = inject(CurrentUserService);
  const router = inject(Router);
  if (auth.accessToken() && auth.sessionUser()) {
    return router.createUrlTree(['/']);
  }
  return true;
};
