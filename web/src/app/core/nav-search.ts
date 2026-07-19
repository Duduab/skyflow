import { SkyflowRole } from './skyflow.models';

export type NavSearchHit = { titleKey: string; path: string };

/** Quick-navigation destinations for global search (role-aware). */
export function buildNavSearchHits(
  role: SkyflowRole | undefined,
): NavSearchHit[] {
  const hits: NavSearchHit[] = [
    { titleKey: 'APP.HEADER_NAV_HOME', path: '/' },
    { titleKey: 'PROFILE.TITLE', path: '/profile' },
  ];
  if (
    role === 'WORKER' ||
    role === 'STATION_MANAGER' ||
    role === 'SITE_MANAGER' ||
    role === 'ADMIN' ||
    role === 'PLANNING'
  ) {
    hits.push({ titleKey: 'APP.WORKER_HUB', path: '/worker' });
  }
  if (role === 'ADMIN') {
    hits.push(
      { titleKey: 'ADMIN_NAV.DASHBOARD', path: '/admin/dashboard' },
      { titleKey: 'ADMIN_NAV.PROJECTS', path: '/admin/projects' },
      { titleKey: 'ADMIN_NAV.SCRAP', path: '/admin/scrap' },
      { titleKey: 'ADMIN_NAV.USERS', path: '/admin/users' },
      { titleKey: 'ADMIN_NAV.SIMULATION', path: '/admin/simulation' },
      { titleKey: 'ADMIN_NAV.FILES', path: '/admin/files' },
      { titleKey: 'ADMIN_NAV.SETTINGS', path: '/admin/settings' },
      { titleKey: 'ADMIN_NAV.PLANNING_NEW', path: '/admin/planning-new' },
      { titleKey: 'ADMIN_NAV.PLANNING_DRAFTS', path: '/admin/planning-drafts' },
    );
  } else if (role === 'PLANNING') {
    hits.push(
      { titleKey: 'ADMIN_NAV.PLANNING_NEW', path: '/admin/planning-new' },
      { titleKey: 'ADMIN_NAV.PLANNING_DRAFTS', path: '/admin/planning-drafts' },
      { titleKey: 'ADMIN_NAV.PROJECTS', path: '/admin/projects' },
    );
  }
  return hits;
}

export function filterNavSearchHits(
  hits: NavSearchHit[],
  query: string,
  labelFor: (titleKey: string) => string,
): NavSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return hits;
  return hits.filter((h) =>
    labelFor(h.titleKey).toLowerCase().includes(q),
  );
}
