import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'skyflow-home-page',
  imports: [RouterLink, TranslateModule],
  template: `
    <div class="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
      <a
        routerLink="/worker"
        class="sf-card-home sf-card-home--worker group shadow-sf-lg"
      >
        <span class="text-hero drop-shadow-md">{{
          'HOME.WORKER_CARD' | translate
        }}</span>
        <span
          class="mt-4 text-touch font-bold text-white/95 group-hover:text-white"
        >
          SkyFlow →
        </span>
      </a>
      <a
        routerLink="/admin"
        class="sf-card-home sf-card-home--admin group shadow-sf-lg"
      >
        <span class="text-hero drop-shadow-md">{{
          'HOME.ADMIN_CARD' | translate
        }}</span>
        <span
          class="mt-4 text-touch font-bold text-white/95 group-hover:text-white"
        >
          Dashboard →
        </span>
      </a>
    </div>
  `,
})
export class HomePageComponent {}
