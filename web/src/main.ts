import { registerLocaleData } from '@angular/common';
import localeAr from '@angular/common/locales/ar';
import localeHe from '@angular/common/locales/he';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

registerLocaleData(localeHe);
registerLocaleData(localeAr);

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
