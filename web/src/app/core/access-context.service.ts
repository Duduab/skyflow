import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AccessContextService {
  /**
   * When real roles exist, drive this from auth instead of defaulting true.
   */
  readonly showAdminNav = signal(true);
}
