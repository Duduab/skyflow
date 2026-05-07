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
    });

    const rows: ShippingRow[] = [];

    for (const o of orders) {
      const agg = await this.prisma.stationLog.aggregate({
        where: { projectId: o.id, stationId: 6 },
        _sum: { processedQty: true },
      });
      const packedQty = agg._sum.processedQty ?? 0;
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
