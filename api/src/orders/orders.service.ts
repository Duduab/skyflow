import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectOrder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface StationTotals {
  stationId: number;
  processedQty: number;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<ProjectOrder[]> {
    return this.prisma.projectOrder.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  async findOne(id: string): Promise<ProjectOrder> {
    const order = await this.prisma.projectOrder.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Project order ${id} not found`);
    }
    return order;
  }

  /** Sum of processedQty logs per station for a project */
  async stationTotals(projectId: string): Promise<StationTotals[]> {
    const grouped = await this.prisma.stationLog.groupBy({
      by: ['stationId'],
      where: { projectId },
      _sum: { processedQty: true },
    });
    return grouped.map((g) => ({
      stationId: g.stationId,
      processedQty: g._sum.processedQty ?? 0,
    }));
  }

  async qtyAtStation(projectId: string, stationId: number): Promise<number> {
    const agg = await this.prisma.stationLog.aggregate({
      where: { projectId, stationId },
      _sum: { processedQty: true },
    });
    return agg._sum.processedQty ?? 0;
  }

  async scrapTotals(projectId: string): Promise<{ stationId: number; scrapQty: number }[]> {
    const grouped = await this.prisma.scrapReport.groupBy({
      by: ['stationId'],
      where: { projectId },
      _sum: { scrapQty: true },
    });
    return grouped.map((g) => ({
      stationId: g.stationId,
      scrapQty: g._sum.scrapQty ?? 0,
    }));
  }
}
