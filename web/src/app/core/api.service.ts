import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AdminDashboard,
  PlanningAssigneeOptionDto,
  PlanningDraftListItemDto,
  PlanningParsePreviewDto,
  ProjectDocumentDto,
  ProjectDocumentKind,
  SendProjectDocumentEmailResponse,
  ProjectOrder,
  ShippingResponse,
  WorkerContext,
  ScrapOverviewResponse,
  SimulationSnapshotResponse,
  ProjectActivityResponse,
  UserDto,
  UserPerformanceResponse,
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

  /** Station 6 — upload pack report photo (multipart). */
  postPackPhoto(projectId: string, slotIndex: number, file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{
      ok: boolean;
      requiredCount: number;
      photos: { slotIndex: number; url: string }[];
      complete: boolean;
    }>(
      `${this.base}/stations/6/pack-photo?projectId=${encodeURIComponent(projectId)}&slotIndex=${slotIndex}`,
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

  getUserPerformance(userId: string): Observable<UserPerformanceResponse> {
    return this.http.get<UserPerformanceResponse>(
      `${this.base}/users/${userId}/performance`,
    );
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

  getPlanningAssignees(): Observable<PlanningAssigneeOptionDto[]> {
    return this.http.get<PlanningAssigneeOptionDto[]>(
      `${this.base}/users/planning-assignees`,
    );
  }

  updateUser(
    id: string,
    body: {
      email?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
      role?: SkyflowRole;
      photoUrl?: string | null;
      managedStationId?: number | null;
    },
  ): Observable<UserDto> {
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

  sendProjectDocumentEmail(
    documentId: string,
    body: {
      recipients: string[];
      message?: string;
      origin?: string;
    },
  ): Observable<SendProjectDocumentEmailResponse> {
    return this.http.post<SendProjectDocumentEmailResponse>(
      `${this.base}/projects/documents/${encodeURIComponent(documentId)}/send-email`,
      body,
    );
  }

  postProjectDocument(
    projectId: string,
    file: File,
    body: {
      kind: ProjectDocumentKind;
      title?: string;
      reference?: string;
    },
  ): Observable<{ ok: true; document: ProjectDocumentDto }> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', body.kind);
    if (body.title?.trim()) {
      fd.append('title', body.title.trim());
    }
    if (body.reference?.trim()) {
      fd.append('reference', body.reference.trim());
    }
    return this.http.post<{ ok: true; document: ProjectDocumentDto }>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/documents`,
      fd,
    );
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

  postApprovePlanning(
    projectId: string,
    body?: {
      assigneeUserId?: string | null;
      planningSawsManagerUserId?: string | null;
      sawsWorkerUserIds?: string[];
    },
  ): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/approve-planning`,
      body ?? {},
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
