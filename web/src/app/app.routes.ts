import { Routes } from '@angular/router';

import { authGuard } from './core/auth.guard';
import { guestOnlyGuard } from './core/guest-only.guard';
import { adminGuard } from './core/admin.guard';
import { adminOnlyGuard } from './core/admin-only.guard';
import { adminOrPlanningGuard } from './core/admin-or-planning.guard';
import { workerGuard } from './core/worker.guard';
import { stationSequenceGuard } from './features/worker/station-sequence.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/home/home-page.component').then(
        (m) => m.HomePageComponent,
      ),
  },
  {
    path: 'login',
    canActivate: [guestOnlyGuard],
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
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/admin/shell/admin-default-redirect.component').then(
            (m) => m.AdminDefaultRedirectComponent,
          ),
      },
      {
        path: 'planning-new',
        loadComponent: () =>
          import('./features/admin/pages/admin-planning-new.component').then(
            (m) => m.AdminPlanningNewComponent,
          ),
      },
      {
        path: 'planning-drafts',
        canActivate: [adminOrPlanningGuard],
        loadComponent: () =>
          import('./features/admin/pages/admin-planning-drafts.component').then(
            (m) => m.AdminPlanningDraftsComponent,
          ),
      },
      {
        path: 'dashboard',
        canActivate: [adminOnlyGuard],
        loadComponent: () =>
          import('./features/admin/admin-dashboard.component').then(
            (m) => m.AdminDashboardComponent,
          ),
      },
      {
        path: 'projects',
        canActivate: [adminOrPlanningGuard],
        loadComponent: () =>
          import('./features/admin/pages/admin-projects.component').then(
            (m) => m.AdminProjectsComponent,
          ),
      },
      {
        path: 'projects/:projectId/live',
        canActivate: [adminOrPlanningGuard],
        loadComponent: () =>
          import('./features/admin/pages/admin-project-live.component').then(
            (m) => m.AdminProjectLiveComponent,
          ),
      },
      {
        path: 'projects/:projectId/stations',
        canActivate: [adminOrPlanningGuard],
        loadComponent: () =>
          import('./features/admin/pages/admin-project-stations.component').then(
            (m) => m.AdminProjectStationsComponent,
          ),
      },
      {
        path: 'scrap',
        canActivate: [adminOnlyGuard],
        loadComponent: () =>
          import('./features/admin/pages/admin-scrap.component').then(
            (m) => m.AdminScrapComponent,
          ),
      },
      {
        path: 'users',
        canActivate: [adminOnlyGuard],
        loadComponent: () =>
          import('./features/admin/pages/admin-users.component').then(
            (m) => m.AdminUsersComponent,
          ),
      },
      {
        path: 'simulation',
        canActivate: [adminOnlyGuard],
        loadComponent: () =>
          import('./features/admin/pages/admin-simulation.component').then(
            (m) => m.AdminSimulationComponent,
          ),
      },
      {
        path: 'files',
        canActivate: [adminOnlyGuard],
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
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/profile/profile-page.component').then(
        (m) => m.ProfilePageComponent,
      ),
  },
  {
    path: 'worker',
    canActivate: [workerGuard],
    loadComponent: () =>
      import('./features/worker/worker-hub.component').then(
        (m) => m.WorkerHubComponent,
      ),
  },
  {
    path: 'worker/:stationId',
    canActivate: [workerGuard, stationSequenceGuard],
    loadComponent: () =>
      import('./features/worker/worker-terminal.component').then(
        (m) => m.WorkerTerminalComponent,
      ),
  },
  { path: '**', redirectTo: '' },
];
