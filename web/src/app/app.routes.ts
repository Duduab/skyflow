import { Routes } from '@angular/router';

import { adminGuard } from './core/admin.guard';
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
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login-page.component').then(
        (m) => m.LoginPageComponent,
      ),
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./features/admin/shell/admin-layout.component').then(
        (m) => m.AdminLayoutComponent,
      ),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/admin/admin-dashboard.component').then(
            (m) => m.AdminDashboardComponent,
          ),
      },
      {
        path: 'projects',
        loadComponent: () =>
          import('./features/admin/pages/admin-projects.component').then(
            (m) => m.AdminProjectsComponent,
          ),
      },
      {
        path: 'projects/:projectId/live',
        loadComponent: () =>
          import('./features/admin/pages/admin-project-live.component').then(
            (m) => m.AdminProjectLiveComponent,
          ),
      },
      {
        path: 'projects/:projectId/stations',
        loadComponent: () =>
          import('./features/admin/pages/admin-project-stations.component').then(
            (m) => m.AdminProjectStationsComponent,
          ),
      },
      {
        path: 'scrap',
        loadComponent: () =>
          import('./features/admin/pages/admin-scrap.component').then(
            (m) => m.AdminScrapComponent,
          ),
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./features/admin/pages/admin-users.component').then(
            (m) => m.AdminUsersComponent,
          ),
      },
      {
        path: 'simulation',
        loadComponent: () =>
          import('./features/admin/pages/admin-simulation.component').then(
            (m) => m.AdminSimulationComponent,
          ),
      },
      {
        path: 'files',
        loadComponent: () =>
          import('./features/admin/pages/admin-files.component').then(
            (m) => m.AdminFilesComponent,
          ),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/admin/pages/admin-settings.component').then(
            (m) => m.AdminSettingsComponent,
          ),
      },
    ],
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
