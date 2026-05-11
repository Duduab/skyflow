import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';

import { CurrentUserService } from './current-user.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(CurrentUserService);
  const router = inject(Router);
  const token = auth.accessToken();
  const authedReq =
    token && !req.headers.has('Authorization')
      ? req.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        })
      : req;
  return next(authedReq).pipe(
    tap({
      error: (err: unknown) => {
        if (!(err instanceof HttpErrorResponse) || err.status !== 401) {
          return;
        }
        if (authedReq.url.includes('/auth/login')) {
          return;
        }
        auth.logout();
        if (router.url.startsWith('/login')) {
          return;
        }
        void router.navigate(['/login'], {
          queryParams: { returnUrl: router.url },
        });
      },
    }),
  );
};
