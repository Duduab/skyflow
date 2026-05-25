import { HttpContextToken, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs/operators';

import { HttpLoadingService } from './http-loading.service';

/** דילוג על overlay — לקריאות שלא צריכות loader גלובלי */
export const SKIP_HTTP_LOADING = new HttpContextToken<boolean>(() => false);

export const httpLoadingInterceptor: HttpInterceptorFn = (req, next) => {
  const loading = inject(HttpLoadingService);
  const track =
    req.url.includes('/api/') && !req.context.get(SKIP_HTTP_LOADING);

  if (track) {
    loading.start();
  }

  return next(req).pipe(
    finalize(() => {
      if (track) {
        loading.end();
      }
    }),
  );
};
