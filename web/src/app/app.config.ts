import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';

import { authInterceptor } from './core/auth.interceptor';
import { httpLoadingInterceptor } from './core/http-loading.interceptor';
import { bundledTranslateLoader } from './core/bundled-translate.loader';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([authInterceptor, httpLoadingInterceptor])),
    ...provideTranslateService({
      fallbackLang: 'he',
      lang: 'he',
      loader: {
        provide: TranslateLoader,
        useFactory: bundledTranslateLoader,
      },
    }),
    provideRouter(routes),
  ],
};
