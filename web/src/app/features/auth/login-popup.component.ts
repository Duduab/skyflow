import {
  Component,
  DestroyRef,
  inject,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { ApiService } from '../../core/api.service';
import { CurrentUserService } from '../../core/current-user.service';
import { SkyflowRole } from '../../core/skyflow.models';
import { MatIconComponent } from '../../shared/mat-icon/mat-icon.component';
import { SkyflowLogoLoaderComponent } from '../../shared/skyflow-logo-loader/skyflow-logo-loader.component';
import { UiButtonComponent } from '../../shared/ui-button.component';
import { UiPopupComponent } from '../../shared/ui-popup/ui-popup.component';

@Component({
  selector: 'skyflow-login-popup',
  imports: [
    FormsModule,
    TranslateModule,
    UiPopupComponent,
    UiButtonComponent,
    MatIconComponent,
    SkyflowLogoLoaderComponent,
  ],
  templateUrl: './login-popup.component.html',
  styleUrl: './login-popup.component.scss',
})
export class LoginPopupComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(CurrentUserService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = input(true);
  readonly requiredRole = input<SkyflowRole>('SITE_MANAGER');
  readonly titleKey = input('LOGIN.SITE_MANAGER_POPUP_TITLE');

  readonly authenticated = output<void>();
  readonly dismissed = output<void>();

  email = '';
  password = '';
  busy = false;
  errorMsg: string | null = null;

  submit(): void {
    const email = this.email.trim().toLowerCase();
    const password = this.password;
    if (!email || !password) {
      this.errorMsg = 'LOGIN.REQUIRED';
      return;
    }

    this.busy = true;
    this.errorMsg = null;
    this.api
      .login(email, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.busy = false;
          if (res.user.role !== this.requiredRole()) {
            this.errorMsg = 'LOGIN.SITE_MANAGER_REQUIRED';
            return;
          }
          this.auth.setSession(res.access_token, res.user);
          this.authenticated.emit();
        },
        error: () => {
          this.busy = false;
          this.errorMsg = 'LOGIN.INVALID';
        },
      });
  }

  onDismiss(): void {
    this.dismissed.emit();
  }
}
