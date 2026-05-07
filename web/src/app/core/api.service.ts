import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AdminDashboard,
  ProjectOrder,
  ShippingResponse,
  WorkerContext,
} from './skyflow.models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  getOrders(): Observable<ProjectOrder[]> {
    return this.http.get<ProjectOrder[]>(`${this.base}/orders`);
  }

  getWorkerContext(
    stationId: number,
    projectId: string,
  ): Observable<WorkerContext> {
    return this.http.get<WorkerContext>(
      `${this.base}/stations/${stationId}/context/${projectId}`,
    );
  }

  postStationLog(stationId: number, body: Record<string, unknown>) {
    return this.http.post(`${this.base}/stations/${stationId}/logs`, body);
  }

  postScrap(stationId: number, body: Record<string, unknown>) {
    return this.http.post(`${this.base}/stations/${stationId}/scrap`, body);
  }

  /** Station 7 — upload תעודת משלוח (multipart). */
  postSiteDeliveryNote(projectId: string, file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{
      ok: boolean;
      deliveryNoteUrl: string;
      expected: { beams: number; glazing: number; unitized: number };
    }>(
      `${this.base}/stations/7/delivery-note?projectId=${encodeURIComponent(projectId)}`,
      fd,
    );
  }

  getAdminDashboard(projectId?: string | null): Observable<AdminDashboard> {
    let url = `${this.base}/admin/dashboard`;
    if (projectId) {
      url += `?projectId=${encodeURIComponent(projectId)}`;
    }
    return this.http.get<AdminDashboard>(url);
  }

  getShippingReady(): Observable<ShippingResponse> {
    return this.http.get<ShippingResponse>(`${this.base}/shipping/ready`);
  }
}
