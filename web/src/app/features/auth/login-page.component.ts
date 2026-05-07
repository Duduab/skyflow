import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { UiButtonComponent } from '../../shared/ui-button.component';
import { ApiService } from '../../core/api.service';
import { CurrentUserService } from '../../core/current-user.service';
import { ThemeService } from '../../core/theme.service';

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
  private readonly theme = inject(ThemeService);

  /** כמו בכותרת — בהיר: לוגו כהה; כהה: לוגו בהיר */
  readonly logoSrc = computed(() =>
    this.theme.mode() === 'light'
      ? '/assets/logo/dark-mode.png'
      : '/assets/logo/bright-mode.png',
  );

  email = '';
  password = '';
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);

  submit(): void {
    const email = this.email.trim();
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
          if (res.user.role !== 'ADMIN') {
            this.errorMsg.set('LOGIN.NOT_ADMIN');
            this.auth.logout();
            return;
          }
          const ret =
            this.route.snapshot.queryParamMap.get('returnUrl') ?? '/admin';
          void this.router.navigateByUrl(ret);
        },
        error: () => {
          this.busy.set(false);
          this.errorMsg.set('LOGIN.INVALID');
        },
      });
  }
}
