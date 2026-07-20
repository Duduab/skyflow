import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ShippingRow {
  projectId: string;
  name: string;
  totalItems: number;
  packedQty: number;
  ready: boolean;
}

@Injectable()
export class ShippingService {
  constructor(private readonly prisma: PrismaService) {}

  async getReadyToShip(): Promise<{ rows: ShippingRow[] }> {
    const orders = await this.prisma.projectOrder.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, totalItems: true },
    });
    if (!orders.length) return { rows: [] };

    // One grouped aggregate for every project instead of one aggregate query
    // per project (was N+1 for N open orders).
    const packedByProject = await this.prisma.stationLog.groupBy({
      by: ['projectId'],
      where: { projectId: { in: orders.map((o) => o.id) }, stationId: 6 },
      _sum: { processedQty: true },
    });
    const packedQtyById = new Map(
      packedByProject.map((p) => [p.projectId, p._sum.processedQty ?? 0]),
    );

    const rows: ShippingRow[] = [];
    for (const o of orders) {
      const packedQty = packedQtyById.get(o.id) ?? 0;
      const ready = packedQty >= o.totalItems;
      if (ready) {
        rows.push({
          projectId: o.id,
          name: o.name,
          totalItems: o.totalItems,
          packedQty,
          ready,
        });
      }
    }

    return { rows };
  }
}
