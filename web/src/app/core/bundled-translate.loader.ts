import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

import ar from '../../assets/i18n/ar.json';
import en from '../../assets/i18n/en.json';
import he from '../../assets/i18n/he.json';

const bundles: Record<string, TranslationObject> = {
  ar: ar as TranslationObject,
  en: en as TranslationObject,
  he: he as TranslationObject,
};

/**
 * Serves i18n from bundled JSON so translations work even when /assets/i18n
 * cannot be fetched (SPA fallback to index.html, wrong base href, proxy, etc.).
 */
export function bundledTranslateLoader(): TranslateLoader {
  return {
    getTranslation(lang: string): Observable<TranslationObject> {
      return of(bundles[lang] ?? {});
    },
  };
}
