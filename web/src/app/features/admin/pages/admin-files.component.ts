import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';

import { ApiService } from '../../../core/api.service';
import { AdminDashboard } from '../../../core/skyflow.models';

@Component({
  selector: 'skyflow-admin-files',
  imports: [TranslateModule],
  templateUrl: './admin-files.component.html',
  styleUrl: './admin-files.component.scss',
})
export class AdminFilesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly data = signal<AdminDashboard | null>(null);

  ngOnInit(): void {
    this.api
      .getAdminDashboard(null)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.data.set(d);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
