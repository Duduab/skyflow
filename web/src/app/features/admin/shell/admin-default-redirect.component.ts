import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { CurrentUserService } from '../../../core/current-user.service';

@Component({
  selector: 'skyflow-admin-default-redirect',
  standalone: true,
  template: '',
})
export class AdminDefaultRedirectComponent implements OnInit {
  private readonly auth = inject(CurrentUserService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    const role = this.auth.sessionUser()?.role;
    const path =
      role === 'PLANNING' ? '/admin/planning-new' : '/admin/dashboard';
    void this.router.navigateByUrl(path, { replaceUrl: true });
  }
}
