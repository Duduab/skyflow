import { HttpClient, HttpEventType, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { filter, finalize, map, tap } from 'rxjs/operators';

import { HttpLoadingService } from './http-loading.service';
import {
  AdminDashboard,
  AssemblyWindowPartsDto,
  PlanningAssigneeOptionDto,
  PlanningDraftListItemDto,
  PlanningParsePreviewDto,
  PlanningPdfKind,
  PlanningPdfPreviewDto,
  PlanningPdfUploadResponse,
  ProjectDocumentDto,
  ProjectDocumentKind,
  ProjectAngleSourcing,
  ElevationMapResponse,
  SendProjectDocumentEmailResponse,
  ProjectLineMaterial,
  ProjectMachiningRoute,
  ProjectOrder,
  ShippingResponse,
  WorkerContext,
  ScrapOverviewResponse,
  SimulationSnapshotResponse,
  ProjectActivityResponse,
  UserDto,
  UserPerformanceResponse,
  UserDailyTargetsResponse,
  UserDailyTargetAlertsResponse,
  UserDailyTargetAlertRow,
  StationManagersResponse,
  SkyflowRole,
  WorkCycle,
  WorkCycleAssignmentInput,
  StationWorkCycleRow,
  WorkerProjectCycle,
} from './skyflow.models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly loading = inject(HttpLoadingService);
  private readonly base = '/api';

  /** הודעת הניתוח המוצגת סביב הלוגו לפי סוג הקובץ המועלה. */
  private analysisLabelKey(kind: PlanningPdfKind): string {
    switch (kind) {
      case 'QUANTITIES_PDF':
        return 'HTTP_LOADER.ANALYZE_QUANTITIES';
      case 'WINDOW_INSTRUCTION_PDF':
        return 'HTTP_LOADER.ANALYZE_WINDOW';
      case 'ANGLE_INSTRUCTION_PDF':
        return 'HTTP_LOADER.ANALYZE_ANGLE';
      case 'CONNECTION_DETAILS_PDF':
        return 'HTTP_LOADER.ANALYZE_CONNECTION';
      case 'ELEVATION_MAP':
        return 'HTTP_LOADER.ANALYZE_ELEVATION';
      default:
        return 'HTTP_LOADER.ANALYZE_GENERIC';
    }
  }

  /**
   * POST של קובץ עם דיווח התקדמות סביב הלוגו: טבעת דטרמיניסטית בזמן ההעלאה
   * (אחוז בייטים), ואז טבעת אינדטרמיניסטית בזמן העיבוד בשרת — עם כותרת הקשר.
   * מחזיר רק את גוף התשובה הסופי, כך שקוראי המתודה נשארים ללא שינוי.
   */
  private postFileWithProgress<T>(
    url: string,
    fd: FormData,
    labelKey: string,
  ): Observable<T> {
    this.loading.beginTask(labelKey);
    return this.http
      .post<T>(url, fd, { reportProgress: true, observe: 'events' })
      .pipe(
        tap((event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const pct = event.total
              ? (event.loaded / event.total) * 100
              : 0;
            if (pct >= 100) {
              this.loading.enterProcessing();
            } else {
              this.loading.setProgress(pct);
            }
          } else if (event.type === HttpEventType.Sent) {
            this.loading.setProgress(0);
          }
        }),
        filter((event) => event.type === HttpEventType.Response),
        map((event) => (event as { body: T }).body),
        finalize(() => this.loading.endTask()),
      );
  }

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

  getStationWorkCycles(
    stationId: number,
    projectId: string,
  ): Observable<StationWorkCycleRow[]> {
    return this.http.get<StationWorkCycleRow[]>(
      `${this.base}/stations/${stationId}/work-cycles/${encodeURIComponent(
        projectId,
      )}`,
    );
  }

  /** All units (work cycles) of a project with instructions — for the hub picker. */
  getProjectWorkCycles(projectId: string): Observable<WorkerProjectCycle[]> {
    return this.http.get<WorkerProjectCycle[]>(
      `${this.base}/stations/project-cycles/${encodeURIComponent(projectId)}`,
    );
  }

  reportStationWorkCycle(
    stationId: number,
    cycleId: string,
    body: { projectId: string; qty: number; cutLength?: number | null },
  ): Observable<WorkCycle> {
    return this.http.post<WorkCycle>(
      `${this.base}/stations/${stationId}/work-cycles/${encodeURIComponent(
        cycleId,
      )}/report`,
      body,
    );
  }

  postScrap(stationId: number, body: Record<string, unknown>) {
    return this.http.post(`${this.base}/stations/${stationId}/scrap`, body);
  }

  /** Station 3 — כמה חלונות הורכבו לסוג יחידה (GL-2 ×26 וכו׳) */
  setAssemblyWindowQty(
    projectId: string,
    productItemId: string,
    assembledQty: number,
  ) {
    return this.http.post<{
      ok: boolean;
      productItemId: string;
      assembledQty: number;
      quantity: number;
      windowsAssembledQty: number;
      windowsTotalQty: number;
    }>(`${this.base}/stations/3/assembly-window-qty`, {
      projectId,
      productItemId,
      assembledQty,
    });
  }

  /** Station 3 — דיווח הרכבה + תמונה לפי TYPE */
  postAssemblyTypeReport(
    projectId: string,
    instructionKind: string,
    file: File,
  ) {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{
      ok: boolean;
      instructionKind: string;
      photoUrl: string;
      assemblyStation: import('./skyflow.models').AssemblyStationContextDto;
    }>(
      `${this.base}/stations/3/assembly-type-report?projectId=${encodeURIComponent(projectId)}&instructionKind=${encodeURIComponent(instructionKind)}`,
      fd,
    );
  }

  /** Station 3 — save parts-mapping checklist for a unit */
  saveAssemblyPartsCheck(
    projectId: string,
    unitCode: string,
    checkedItemKeys: string[],
    highlightActive: boolean,
  ) {
    return this.http.post<{
      ok: boolean;
      assemblyPartsCheck: import('./skyflow.models').AssemblyPartsCheckDto;
    }>(`${this.base}/stations/3/assembly-parts-check`, {
      projectId,
      unitCode,
      checkedItemKeys,
      highlightActive,
    });
  }

  /** Station 4 — אישור / ביטול הדבקות לפי TYPE */
  setGluingTypeDone(
    projectId: string,
    instructionKind: string,
    done: boolean,
  ) {
    return this.http.post<{
      ok: boolean;
      instructionKind: string;
      done: boolean;
      gluingStation: import('./skyflow.models').GluingStationContextDto;
    }>(`${this.base}/stations/4/gluing-type`, {
      projectId,
      instructionKind,
      done,
    });
  }

  /** Station 7 — upload תעודת משלוח (deprecated — issued at station 6). */
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

  /** Station 6 — preview delivery note line items */
  getDeliveryNotePreview(projectId: string) {
    return this.http.get<{
      issued: boolean;
      canIssue: boolean;
      packComplete: boolean;
      noteNumber: string | null;
      shippingType: 'INTERNAL' | 'EXTERNAL' | null;
      externalPrice: string | null;
      documentUrl: string | null;
      issuedAt: string | null;
      lineItems: import('./skyflow.models').DeliveryNoteLineItemDto[];
    }>(
      `${this.base}/stations/6/delivery-note/preview?projectId=${encodeURIComponent(projectId)}`,
    );
  }

  /** Station 6 — issue delivery note */
  issueDeliveryNote(
    projectId: string,
    shippingType: 'INTERNAL' | 'EXTERNAL',
    lineItems: { lineKey: string; quantity: number }[],
    externalPrice?: number | null,
  ) {
    return this.http.post<{
      ok: boolean;
      noteNumber: string;
      shippingType: 'INTERNAL' | 'EXTERNAL';
      externalPrice: string | null;
      documentUrl: string;
      issuedAt: string;
      isPartial: boolean;
      lineItems: import('./skyflow.models').DeliveryNoteLineItemDto[];
      expected: { beams: number; glazing: number; unitized: number };
    }>(`${this.base}/stations/6/delivery-note/issue`, {
      projectId,
      shippingType,
      lineItems,
      externalPrice: externalPrice ?? undefined,
    });
  }

  updateAdminDeliveryNote(
    id: string,
    body: {
      shippingType?: 'INTERNAL' | 'EXTERNAL';
      externalPrice?: number | null;
    },
  ) {
    return this.http.patch<{
      ok: boolean;
      id: string;
      noteNumber: string;
      shippingType: 'INTERNAL' | 'EXTERNAL';
      externalPrice: string | null;
      documentUrl: string;
    }>(`${this.base}/admin/delivery-notes/${encodeURIComponent(id)}`, body);
  }

  cancelAdminDeliveryNote(id: string) {
    return this.http.post<{ ok: boolean; id: string; status: string }>(
      `${this.base}/admin/delivery-notes/${encodeURIComponent(id)}/cancel`,
      {},
    );
  }

  getAdminDeliveryNotes(projectId?: string | null) {
    let url = `${this.base}/admin/delivery-notes`;
    if (projectId) {
      url += `?projectId=${encodeURIComponent(projectId)}`;
    }
    return this.http.get<import('./skyflow.models').AdminDeliveryNoteRow[]>(url);
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

  getUserDailyTargets(userId: string): Observable<UserDailyTargetsResponse> {
    return this.http.get<UserDailyTargetsResponse>(
      `${this.base}/users/${encodeURIComponent(userId)}/daily-targets`,
    );
  }

  upsertUserDailyTarget(
    userId: string,
    body: {
      targetDate?: string;
      description: string;
      targetMinutes: number;
    },
  ): Observable<UserDailyTargetsResponse> {
    return this.http.post<UserDailyTargetsResponse>(
      `${this.base}/users/${encodeURIComponent(userId)}/daily-targets`,
      body,
    );
  }

  getTodayTargetAlerts(): Observable<UserDailyTargetAlertsResponse> {
    return this.http.get<UserDailyTargetAlertsResponse>(
      `${this.base}/users/daily-targets/today-alerts`,
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

  /** מנהלי אתר/פרויקט — לבחירת מנהל פרויקט בשלב פתיחת הפרויקט. */
  getSiteManagers(): Observable<PlanningAssigneeOptionDto[]> {
    return this.http.get<PlanningAssigneeOptionDto[]>(
      `${this.base}/users/site-managers`,
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

  postPlanningDraft(body: {
    name: string;
    requirements?: string;
    lineMaterial: ProjectLineMaterial;
    machiningRoute: ProjectMachiningRoute;
    angleSourcing?: ProjectAngleSourcing;
    projectManagerUserId?: string | null;
  }): Observable<ProjectOrder> {
    const payload: Record<string, string> = {
      name: body.name,
      lineMaterial: body.lineMaterial,
      machiningRoute: body.machiningRoute,
    };
    if (body.angleSourcing) payload['angleSourcing'] = body.angleSourcing;
    const details = body.requirements?.trim();
    if (details) payload['requirements'] = details;
    if (body.projectManagerUserId)
      payload['projectManagerUserId'] = body.projectManagerUserId;
    return this.http.post<ProjectOrder>(`${this.base}/projects`, payload);
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

  getElevationMap(
    projectId: string,
    group?: string | null,
  ): Observable<ElevationMapResponse> {
    const q = group ? `?group=${encodeURIComponent(group)}` : '';
    return this.http.get<ElevationMapResponse>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/elevation-map${q}`,
    );
  }

  markElevationCells(
    projectId: string,
    cellIds: string[],
    done: boolean,
  ): Observable<{ updated: number }> {
    return this.http.post<{ updated: number }>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/elevation-map/cells/mark`,
      { cellIds, done },
    );
  }

  getPlanningDraftsList(): Observable<PlanningDraftListItemDto[]> {
    return this.http.get<PlanningDraftListItemDto[]>(
      `${this.base}/projects/planning/list`,
    );
  }

  /** פריט resume לאשף לפי מזהה — עובד גם על פרויקט שכבר בביצוע. */
  getPlanningResumeItem(projectId: string): Observable<PlanningDraftListItemDto> {
    return this.http.get<PlanningDraftListItemDto>(
      `${this.base}/projects/${projectId}/planning/resume`,
    );
  }

  patchPlanningDraft(
    projectId: string,
    body: {
      name?: string;
      requirements?: string;
      lineMaterial?: import('./skyflow.models').ProjectLineMaterial;
      machiningRoute?: import('./skyflow.models').ProjectMachiningRoute;
      angleSourcing?: ProjectAngleSourcing;
    },
  ): Observable<PlanningDraftListItemDto> {
    return this.http.patch<PlanningDraftListItemDto>(
      `${this.base}/projects/planning/${encodeURIComponent(projectId)}`,
      body,
    );
  }

  deletePlanningDraft(projectId: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(
      `${this.base}/projects/planning/${encodeURIComponent(projectId)}`,
    );
  }

  /** @deprecated זרימת Excel (TPI) — הוחלפה ב-`uploadPlanningPdf` (4 PDF). */
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

  /** @deprecated זרימת Excel — הוחלפה ב-`getPlanningPdfPreview`. */
  getPlanningPreview(projectId: string): Observable<PlanningParsePreviewDto> {
    return this.http.get<PlanningParsePreviewDto>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/planning/preview`,
    );
  }

  /** אשף 4 PDF — העלאת אחד מארבעת הקבצים + פרסור */
  uploadPlanningPdf(
    projectId: string,
    file: File,
    kind: PlanningPdfKind,
    title?: string,
    targetQty?: number,
  ): Observable<PlanningPdfUploadResponse> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    if (title?.trim()) fd.append('title', title.trim());
    if (targetQty != null && Number.isFinite(targetQty)) {
      fd.append('targetQty', String(Math.max(0, Math.floor(targetQty))));
    }
    return this.postFileWithProgress<PlanningPdfUploadResponse>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/planning/pdf`,
      fd,
      this.analysisLabelKey(kind),
    );
  }

  /** העלאת PDF ליחידה בודדת (שורת סוג-חלון בטבלת הכמויות) */
  uploadWindowTypePdf(
    projectId: string,
    windowTypeId: string,
    file: File,
    kind: PlanningPdfKind,
  ): Observable<PlanningPdfUploadResponse> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    return this.postFileWithProgress<PlanningPdfUploadResponse>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/planning/window-types/${encodeURIComponent(
        windowTypeId,
      )}/pdf`,
      fd,
      this.analysisLabelKey(kind),
    );
  }

  getPlanningPdfPreview(
    projectId: string,
  ): Observable<PlanningPdfPreviewDto> {
    return this.http.get<PlanningPdfPreviewDto>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/planning/pdf-preview`,
    );
  }

  /** שמירת מיפוי חלקים שנערך ידנית ע"י המתכנן ליחידה — מחזיר תצוגה מקדימה מעודכנת */
  saveWindowTypeParts(
    projectId: string,
    windowTypeId: string,
    parts: AssemblyWindowPartsDto,
  ): Observable<{ ok: true; parts: AssemblyWindowPartsDto; preview: PlanningPdfPreviewDto }> {
    return this.http.post<{
      ok: true;
      parts: AssemblyWindowPartsDto;
      preview: PlanningPdfPreviewDto;
    }>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/planning/window-types/${encodeURIComponent(
        windowTypeId,
      )}/parts`,
      parts,
    );
  }

  /** העלאת מפת חזיתות עבור קבוצת חזית (S / N5 / W2) — קובץ אחד לכל הקבוצה */
  uploadFacadeGroupElevation(
    projectId: string,
    groupKey: string,
    file: File,
  ): Observable<PlanningPdfUploadResponse> {
    const fd = new FormData();
    fd.append('file', file);
    return this.postFileWithProgress<PlanningPdfUploadResponse>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/planning/facade-groups/${encodeURIComponent(
        groupKey,
      )}/elevation`,
      fd,
      'HTTP_LOADER.ANALYZE_ELEVATION',
    );
  }

  reportElevationDefect(
    projectId: string,
    cellId: string,
    returnedToStationId: number,
    reason: string,
  ): Observable<{ ok: boolean; defectId: string }> {
    return this.http.post<{ ok: boolean; defectId: string }>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/elevation-map/cells/defect`,
      { cellId, returnedToStationId, reason },
    );
  }

  resolveElevationDefect(
    projectId: string,
    defectId: string,
  ): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/elevation-map/defects/${encodeURIComponent(defectId)}/resolve`,
      {},
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

  getWorkCycles(projectId: string): Observable<WorkCycle[]> {
    return this.http.get<WorkCycle[]>(
      `${this.base}/projects/${encodeURIComponent(projectId)}/work-cycles`,
    );
  }

  setWorkCycleAssignments(
    projectId: string,
    cycleId: string,
    assignments: WorkCycleAssignmentInput[],
  ): Observable<WorkCycle> {
    return this.http.post<WorkCycle>(
      `${this.base}/projects/${encodeURIComponent(
        projectId,
      )}/work-cycles/${encodeURIComponent(cycleId)}/assignments`,
      { assignments },
    );
  }

  setWorkCycleDailyTarget(
    projectId: string,
    cycleId: string,
    dailyTargetQty: number | null,
  ): Observable<WorkCycle> {
    return this.http.post<WorkCycle>(
      `${this.base}/projects/${encodeURIComponent(
        projectId,
      )}/work-cycles/${encodeURIComponent(cycleId)}/daily-target`,
      { dailyTargetQty },
    );
  }

  launchWorkCycle(
    projectId: string,
    cycleId: string,
    assignments: WorkCycleAssignmentInput[],
    dailyTargetQty: number | null,
  ): Observable<WorkCycle> {
    return this.http.post<WorkCycle>(
      `${this.base}/projects/${encodeURIComponent(
        projectId,
      )}/work-cycles/${encodeURIComponent(cycleId)}/launch`,
      { assignments, dailyTargetQty },
    );
  }
}
