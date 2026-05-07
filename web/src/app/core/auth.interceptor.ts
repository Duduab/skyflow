import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { CurrentUserService } from './current-user.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(CurrentUserService);
  const token = auth.accessToken();
  if (!token) {
    return next(req);
  }
  return next(
    req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    }),
  );
};
