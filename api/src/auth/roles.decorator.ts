import { SetMetadata } from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';

export const ROLES_KEY = 'skyflowRoles';
export const Roles = (...roles: SkyflowRole[]) =>
  SetMetadata(ROLES_KEY, roles);
