import { Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { CurrentUserService } from '../../core/current-user.service';

@Component({
  selector: 'skyflow-profile-page',
  imports: [TranslateModule],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.scss',
})
export class ProfilePageComponent {
  readonly user = inject(CurrentUserService);
}
