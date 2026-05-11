import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AdminDashboard,
  PlanningDraftListItemDto,
  PlanningParsePreviewDto,
  ProjectOrder,
  ShippingResponse,
  WorkerContext,
  ScrapOverviewResponse,
  SimulationSnapshotResponse,
  ProjectActivityResponse,
  UserDto,
  StationManagersResponse,
  SkyflowRole,
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

  getScrapOverview(projectId?: string | null): Observable<ScrapOverviewResponse> {
    const headers = new HttpHeaders({
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    });
    if (projectId) {
      return this.http.get<ScrapOverviewResponse>(`${this.base}/admin/scrap`, {
        params: { projectId },
        headers,
      });
    }
    return this.http.get<ScrapOverviewResponse>(`${this.base}/admin/scrap`, {
      headers,
    });
  }

  getSimulationSnapshot(): Observable<SimulationSnapshotResponse> {
    return this.http.get<SimulationSnapshotResponse>(
      `${this.base}/admin/simulation`,
    );
  }

  getProjectActivity(projectId: string): Observable<ProjectActivityResponse> {
    const url = `${this.base}/admin/projects/${encodeURIComponent(projectId)}/activity`;
    /** מונע 304 ללא גוף מהדפדפן — אחרת JSON ריק והמודאל נשאר ריק */
    const nocache = String(Date.now());
    return this.http.get<ProjectActivityResponse>(url, {
      params: { _: nocache },
      headers: new HttpHeaders({
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      }),
    });
  }

  getUsers(): Observable<UserDto[]> {
    return this.http.get<UserDto[]>(`${this.base}/users`);
  }

  createUser(body: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: SkyflowRole;
    photoUrl?: string;
    managedStationId?: number;
  }): Observable<UserDto> {
    return this.http.post<UserDto>(`${this.base}/users`, body);
  }

  getStationManagers(): Observable<StationManagersResponse> {
    return this.http.get<StationManagersResponse>(
      `${this.base}/users/station-managers`,
    );
  }

  updateUser(id: string, body: Partial<{ firstName: string; lastName: string; photoUrl: string | null; password: string }>) {
    return this.http.patch<UserDto>(`${this.base}/users/${id}`, body);
  }

  login(email: string, password: string): Observable<{
    access_token: string;
    user: UserDto;
  }> {
    return this.http.post<{ access_token: string; user: UserDto }>(
      `${this.base}/auth/login`,
      { email, password },
    );
  }

  postPlanningDraft(name: string): Observable<ProjectOrder> {
    return this.http.post<ProjectOrder>(`${this.base}/projects`, { name });
  }

  getPlanningDraftsList(): Observable<PlanningDraftListItemDto[]> {
    return this.http.get<PlanningDraftListItemDto[]>(
      `${this.base}/projects/planning/list`,
    );
  }

  postPlanningUpload(
    projectId: string,
    file: File,
  ): Observable<PlanningParsePreviewDto> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<PlanningParsePreviewDto>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/planning/upload`,
      fd,
    );
  }

  getPlanningPreview(projectId: string): Observable<PlanningParsePreviewDto> {
    return this.http.get<PlanningParsePreviewDto>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/planning/preview`,
    );
  }

  postApprovePlanning(projectId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/approve-planning`,
      {},
    );
  }

  postCompleteProject(projectId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/complete`,
      {},
    );
  }

  getCanComplete(projectId: string): Observable<{ canComplete: boolean }> {
    return this.http.get<{ canComplete: boolean }>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/can-complete`,
    );
  }
}
