import { Injectable, NotFoundException } from '@nestjs/common';
import { SkyflowRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async findAll() {
    const rows = await this.prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
    });
    return rows.map((u) => this.auth.toPublic(u));
  }

  /** Station / site managers for worker hub cards (one per station if assigned). */
  async stationManagers() {
    const rows = await this.prisma.user.findMany({
      where: {
        role: {
          in: [SkyflowRole.STATION_MANAGER, SkyflowRole.SITE_MANAGER],
        },
        managedStationId: { not: null },
      },
      select: {
        managedStationId: true,
        firstName: true,
        lastName: true,
        photoUrl: true,
      },
    });
    const byStation: Record<
      number,
      { firstName: string; lastName: string; photoUrl: string | null }
    > = {};
    for (const r of rows) {
      const sid = r.managedStationId!;
      byStation[sid] = {
        firstName: r.firstName,
        lastName: r.lastName,
        photoUrl: r.photoUrl,
      };
    }
    return byStation;
  }

  async create(dto: CreateUserDto) {
    const hash = await bcrypt.hash(dto.password, 10);
    const stationBound =
      dto.role === SkyflowRole.STATION_MANAGER ||
      dto.role === SkyflowRole.SITE_MANAGER;
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: hash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        photoUrl: dto.photoUrl ?? null,
        managedStationId: stationBound ? dto.managedStationId ?? null : null,
      },
    });
    return this.auth.toPublic(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    let passwordHash: string | undefined;
    if (dto.password) {
      passwordHash = await bcrypt.hash(dto.password, 10);
    }
    const role = dto.role ?? existing.role;
    const stationBound =
      role === SkyflowRole.STATION_MANAGER ||
      role === SkyflowRole.SITE_MANAGER;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        email: dto.email ?? undefined,
        firstName: dto.firstName ?? undefined,
        lastName: dto.lastName ?? undefined,
        role: dto.role ?? undefined,
        photoUrl: dto.photoUrl === undefined ? undefined : dto.photoUrl,
        managedStationId: stationBound
          ? dto.managedStationId !== undefined
            ? dto.managedStationId
            : existing.managedStationId
          : null,
        ...(passwordHash ? { passwordHash } : {}),
      },
    });
    return this.auth.toPublic(user);
  }
}
