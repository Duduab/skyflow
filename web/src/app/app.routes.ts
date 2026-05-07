import { Routes } from '@angular/router';

import { stationSequenceGuard } from './features/worker/station-sequence.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/home/home-page.component').then(
        (m) => m.HomePageComponent,
      ),
  },
  {
    path: 'admin',
    loadComponent: () =>
      import('./features/admin/admin-dashboard.component').then(
        (m) => m.AdminDashboardComponent,
      ),
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./features/profile/profile-page.component').then(
        (m) => m.ProfilePageComponent,
      ),
  },
  {
    path: 'worker',
    loadComponent: () =>
      import('./features/worker/worker-hub.component').then(
        (m) => m.WorkerHubComponent,
      ),
  },
  {
    path: 'worker/:stationId',
    loadComponent: () =>
      import('./features/worker/worker-terminal.component').then(
        (m) => m.WorkerTerminalComponent,
      ),
    canActivate: [stationSequenceGuard],
  },
  { path: '**', redirectTo: '' },
];
