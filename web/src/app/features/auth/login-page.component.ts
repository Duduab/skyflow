import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { UiButtonComponent } from '../../shared/ui-button.component';
import { ApiService } from '../../core/api.service';
import { CurrentUserService } from '../../core/current-user.service';
@Component({
  selector: 'skyflow-login-page',
  imports: [FormsModule, RouterLink, TranslateModule, UiButtonComponent],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
})
export class LoginPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(CurrentUserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  /** כרטיס לוגין לבן — תמיד לוגו כהה לניגודיות */
  readonly logoSrc = '/assets/logo/dark-mode.png';

  email = '';
  password = '';
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);

  submit(): void {
    const email = this.email.trim().toLowerCase();
    const password = this.password;
    if (!email || !password) {
      this.errorMsg.set('LOGIN.REQUIRED');
      return;
    }
    this.busy.set(true);
    this.errorMsg.set(null);
    this.api
      .login(email, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.auth.setSession(res.access_token, res.user);
          const role = res.user.role;
          const retRaw =
            this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
          const ret =
            retRaw.startsWith('/') && !retRaw.startsWith('//')
              ? retRaw
              : '';

          if (role === 'ADMIN') {
            void this.router.navigateByUrl(ret || '/admin');
            return;
          }
          if (role === 'PLANNING') {
            void this.router.navigateByUrl(
              ret.startsWith('/admin') ? ret : '/admin/planning-new',
            );
            return;
          }
          if (
            role === 'WORKER' ||
            role === 'STATION_MANAGER' ||
            role === 'SITE_MANAGER'
          ) {
            void this.router.navigateByUrl(ret || '/worker');
            return;
          }

          this.errorMsg.set('LOGIN.UNKNOWN_ROLE');
          this.auth.logout();
        },
        error: () => {
          this.busy.set(false);
          this.errorMsg.set('LOGIN.INVALID');
        },
      });
  }
}
