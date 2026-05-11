import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { UiButtonComponent } from '../../../shared/ui-button.component';
import { ApiService } from '../../../core/api.service';
import { SkyflowRole, UserDto } from '../../../core/skyflow.models';

const ROLE_OPTIONS: SkyflowRole[] = [
  'WORKER',
  'ADMIN',
  'PLANNING',
  'STATION_MANAGER',
  'SITE_MANAGER',
];

@Component({
  selector: 'skyflow-admin-users',
  imports: [FormsModule, TranslateModule, UiButtonComponent],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss',
})
export class AdminUsersComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly users = signal<UserDto[]>([]);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  readonly roleOptions = ROLE_OPTIONS;

  newEmail = '';
  newPassword = '';
  newFirstName = '';
  newLastName = '';
  newRole: SkyflowRole = 'WORKER';
  newManagedStationId: number | null = null;

  ngOnInit(): void {
    this.reloadUsers();
  }

  needsStation(): boolean {
    return (
      this.newRole === 'STATION_MANAGER' || this.newRole === 'SITE_MANAGER'
    );
  }

  submitCreate(): void {
    this.formError.set(null);
    const email = this.newEmail.trim();
    const password = this.newPassword;
    const firstName = this.newFirstName.trim();
    const lastName = this.newLastName.trim();
    if (!email || !password || !firstName || !lastName) {
      this.formError.set('ADMIN_USERS_PAGE.FORM_REQUIRED');
      return;
    }
    if (password.length < 6) {
      this.formError.set('ADMIN_USERS_PAGE.PASSWORD_MIN');
      return;
    }
    const body: Parameters<ApiService['createUser']>[0] = {
      email,
      password,
      firstName,
      lastName,
      role: this.newRole,
    };
    if (this.needsStation() && this.newManagedStationId != null) {
      body.managedStationId = this.newManagedStationId;
    }
    this.saving.set(true);
    this.api
      .createUser(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (u) => {
          this.saving.set(false);
          this.users.update((list) =>
            [...list, u].sort((a, b) => {
              const byRole = a.role.localeCompare(b.role);
              if (byRole !== 0) return byRole;
              return a.lastName.localeCompare(b.lastName);
            }),
          );
          this.newEmail = '';
          this.newPassword = '';
          this.newFirstName = '';
          this.newLastName = '';
          this.newRole = 'WORKER';
          this.newManagedStationId = null;
        },
        error: () => {
          this.saving.set(false);
          this.formError.set('ADMIN_USERS_PAGE.FORM_ERROR');
        },
      });
  }

  private reloadUsers(): void {
    this.loading.set(true);
    this.api
      .getUsers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (u) => {
          this.users.set(u);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
