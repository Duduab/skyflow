import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { CurrentUserService } from '../../core/current-user.service';

@Component({
  selector: 'skyflow-home-page',
  imports: [RouterLink, TranslateModule],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent {
  readonly auth = inject(CurrentUserService);
}
