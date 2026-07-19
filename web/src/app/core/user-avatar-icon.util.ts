import { SkyflowRole } from './skyflow.models';

/** Material Symbol shown when a user has no profile photo. */
export function avatarIconForRole(role: SkyflowRole | null | undefined): string {
  switch (role) {
    case 'ADMIN':
      return 'manage_accounts';
    case 'PLANNING':
      return 'draw';
    case 'SITE_MANAGER':
      return 'engineering';
    default:
      return 'person';
  }
}
