import { fromEvent, interval, merge, Observable } from 'rxjs';
import { filter, map, startWith } from 'rxjs/operators';

/**
 * Like `interval(ms)`, but skips ticks while the tab is hidden (Page
 * Visibility API) and fires an extra tick right when the tab becomes visible
 * again — so a background tab doesn't keep polling every `ms` for no one to
 * see, yet the view refreshes immediately (not after a stale full period)
 * once the user comes back to it. Always emits once immediately on
 * subscribe, regardless of visibility, so the initial load isn't delayed.
 */
export function visibilityAwareInterval(ms: number): Observable<number> {
  const becameVisible$ = fromEvent(document, 'visibilitychange').pipe(
    filter(() => !document.hidden),
    map(() => -1),
  );

  return merge(interval(ms), becameVisible$).pipe(
    filter(() => !document.hidden),
    startWith(0),
  );
}
