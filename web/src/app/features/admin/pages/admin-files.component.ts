import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  Component,
  computed,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { finalize, map, switchMap, take } from 'rxjs/operators';

import { ApiService } from '../../../core/api.service';
import {
  AdminDashboard,
  ProjectDocumentKind,
  UserDto,
} from '../../../core/skyflow.models';
import { LanguageService } from '../../../core/language.service';
import { ThemeService } from '../../../core/theme.service';

export type FilesKindFilter = '' | ProjectDocumentKind;

export interface AdminFileListItem {
  id: string;
  projectId: string;
  projectName: string;
  kind: ProjectDocumentKind;
  title: string;
  reference: string | null;
  pdfUrl: string;
  createdAt: string;
}

@Component({
  selector: 'skyflow-admin-files',
  imports: [TranslateModule, DatePipe],
  templateUrl: './admin-files.component.html',
  styleUrl: './admin-files.component.scss',
})
export class AdminFilesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly lang = inject(LanguageService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly theme = inject(ThemeService);

  readonly docFile = viewChild<ElementRef<HTMLInputElement>>('docFile');

  readonly loading = signal(true);
  readonly data = signal<AdminDashboard | null>(null);

  readonly projectFilter = signal('');
  readonly kindFilter = signal<FilesKindFilter>('');

  readonly previewFile = signal<AdminFileListItem | null>(null);
  readonly sendModalOpen = signal(false);
  readonly companyUsers = signal<UserDto[]>([]);
  readonly sendRecipients = signal<string[]>([]);
  readonly sendCustomEmail = signal('');
  readonly sendMessage = signal('');
  readonly sendBusy = signal(false);
  readonly sendError = signal<string | null>(null);
  readonly sendOk = signal(false);
  readonly uploadModalOpen = signal(false);
  readonly uploadMode = signal<'existing' | 'new'>('existing');
  readonly selectedProjectId = signal('');
  readonly newProjectName = signal('');
  readonly docKind = signal<ProjectDocumentKind>('WORK_ORDER');
  readonly uploadTitle = signal('');
  readonly uploadReference = signal('');
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly uploadOk = signal(false);

  readonly kindFilterOptions: { value: FilesKindFilter; labelKey: string }[] = [
    { value: '', labelKey: 'ADMIN_FILES_PAGE.FILTER_ALL' },
    { value: 'WORK_ORDER', labelKey: 'ADMIN_FILES_PAGE.KIND_WORK_ORDER' },
    { value: 'PURCHASE_ORDER', labelKey: 'ADMIN_FILES_PAGE.KIND_PURCHASE_ORDER' },
  ];

  readonly stats = computed(() => {
    const d = this.data();
    if (!d) return { projects: 0, workOrders: 0, purchaseOrders: 0, total: 0 };
    let workOrders = 0;
    let purchaseOrders = 0;
    for (const p of d.projects) {
      workOrders += p.workOrders.length;
      purchaseOrders += p.purchaseOrders.length;
    }
    return {
      projects: d.projects.length,
      workOrders,
      purchaseOrders,
      total: workOrders + purchaseOrders,
    };
  });

  readonly allFiles = computed((): AdminFileListItem[] => {
    const d = this.data();
    if (!d) return [];
    const items: AdminFileListItem[] = [];
    for (const p of d.projects) {
      for (const doc of p.workOrders) {
        items.push({
          id: doc.id,
          projectId: p.id,
          projectName: p.name,
          kind: 'WORK_ORDER',
          title: doc.title,
          reference: doc.reference,
          pdfUrl: doc.pdfUrl,
          createdAt: doc.createdAt,
        });
      }
      for (const doc of p.purchaseOrders) {
        items.push({
          id: doc.id,
          projectId: p.id,
          projectName: p.name,
          kind: 'PURCHASE_ORDER',
          title: doc.title,
          reference: doc.reference,
          pdfUrl: doc.pdfUrl,
          createdAt: doc.createdAt,
        });
      }
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  readonly visibleFiles = computed(() => {
    const pf = this.projectFilter();
    const kf = this.kindFilter();
    return this.allFiles().filter((f) => {
      if (pf && f.projectId !== pf) return false;
      if (kf && f.kind !== kf) return false;
      return true;
    });
  });

  readonly filterEmpty = computed(
    () => this.allFiles().length > 0 && this.visibleFiles().length === 0,
  );

  ngOnInit(): void {
    this.loadDashboard();
  }

  dateLocale(): string {
    const c = this.lang.current();
    if (c === 'en') return 'en-GB';
    if (c === 'ar') return 'ar';
    return 'he-IL';
  }

  isKindFilterActive(value: FilesKindFilter): boolean {
    return this.kindFilter() === value;
  }

  setKindFilter(value: FilesKindFilter): void {
    this.kindFilter.set(value);
  }

  onProjectFilterChange(value: string): void {
    this.projectFilter.set(value);
  }

  openPreview(file: AdminFileListItem): void {
    this.previewFile.set(file);
  }

  previewPdfSrc(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.pdfEmbedUrl(url, true));
  }

  /** In-modal preview: hide built-in PDF viewer chrome (toolbar, side panes). */
  private pdfEmbedUrl(url: string, chromeless: boolean): string {
    if (!chromeless) return url;
    const path = url.split('#')[0] ?? url;
    return `${path}#toolbar=0&navpanes=0&scrollbar=0&statusbar=0&view=FitH`;
  }

  closePreview(): void {
    this.closeSendModal();
    this.previewFile.set(null);
  }

  openSendModal(): void {
    if (!this.previewFile()) return;
    this.sendModalOpen.set(true);
    this.sendRecipients.set([]);
    this.sendCustomEmail.set('');
    this.sendMessage.set('');
    this.sendError.set(null);
    this.sendOk.set(false);
    if (!this.companyUsers().length) {
      this.api
        .getUsers()
        .pipe(take(1))
        .subscribe({
          next: (users) => this.companyUsers.set(users),
          error: () => this.sendError.set('ADMIN_FILES_PAGE.SEND_ERR_LOAD_USERS'),
        });
    }
  }

  closeSendModal(): void {
    if (this.sendBusy()) return;
    this.sendModalOpen.set(false);
    this.sendError.set(null);
    this.sendOk.set(false);
  }

  userDisplayName(u: UserDto): string {
    const name = `${u.firstName} ${u.lastName}`.trim();
    return name || u.email;
  }

  isSendRecipient(email: string): boolean {
    return this.sendRecipients().includes(email.toLowerCase());
  }

  toggleSendRecipient(email: string): void {
    const norm = email.trim().toLowerCase();
    if (!norm) return;
    const cur = this.sendRecipients();
    if (cur.includes(norm)) {
      this.sendRecipients.set(cur.filter((e) => e !== norm));
    } else {
      this.sendRecipients.set([...cur, norm]);
    }
    this.sendError.set(null);
  }

  removeSendRecipient(email: string): void {
    const norm = email.toLowerCase();
    this.sendRecipients.set(this.sendRecipients().filter((e) => e !== norm));
  }

  addCustomSendRecipient(): void {
    const raw = this.sendCustomEmail().trim().toLowerCase();
    if (!raw) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      this.sendError.set('ADMIN_FILES_PAGE.SEND_ERR_INVALID_EMAIL');
      return;
    }
    if (!this.sendRecipients().includes(raw)) {
      this.sendRecipients.set([...this.sendRecipients(), raw]);
    }
    this.sendCustomEmail.set('');
    this.sendError.set(null);
  }

  submitSend(): void {
    const file = this.previewFile();
    const recipients = this.sendRecipients();
    if (!file) return;
    if (!recipients.length) {
      this.sendError.set('ADMIN_FILES_PAGE.SEND_ERR_NO_RECIPIENTS');
      return;
    }

    this.sendBusy.set(true);
    this.sendError.set(null);
    this.sendOk.set(false);

    const message = this.sendMessage().trim();
    this.api
      .sendProjectDocumentEmail(file.id, {
        recipients,
        message: message || undefined,
        origin: typeof window !== 'undefined' ? window.location.origin : undefined,
      })
      .pipe(finalize(() => this.sendBusy.set(false)), take(1))
      .subscribe({
        next: (res) => {
          if (res.sent) {
            this.sendOk.set(true);
            return;
          }
          if (res.mailto) {
            window.location.href = res.mailto;
            this.sendOk.set(true);
          }
        },
        error: () => {
          const mailto = this.buildMailtoFallback(file, recipients, message);
          window.location.href = mailto;
          this.sendOk.set(true);
        },
      });
  }

  private buildMailtoFallback(
    file: AdminFileListItem,
    recipients: string[],
    message: string,
  ): string {
    const link = `${window.location.origin}${file.pdfUrl}`;
    const kind =
      file.kind === 'PURCHASE_ORDER'
        ? 'Purchase order'
        : 'Work order';
    const body = [
      message,
      message ? '' : undefined,
      `Project: ${file.projectName}`,
      `Type: ${kind}`,
      file.reference ? `Reference: ${file.reference}` : undefined,
      `File: ${link}`,
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n');
    const params = new URLSearchParams();
    params.set('subject', file.title);
    params.set('body', body);
    return `mailto:${recipients.join(',')}?${params.toString()}`;
  }

  openPreviewInNewTab(): void {
    const f = this.previewFile();
    if (!f) return;
    window.open(f.pdfUrl, '_blank', 'noopener,noreferrer');
  }

  downloadPreview(): void {
    const f = this.previewFile();
    if (!f) return;
    const anchor = document.createElement('a');
    anchor.href = f.pdfUrl;
    anchor.download = this.downloadFileName(f);
    anchor.rel = 'noopener';
    anchor.click();
  }

  openUploadModal(): void {
    this.uploadError.set(null);
    this.uploadOk.set(false);
    this.uploadModalOpen.set(true);
  }

  closeUploadModal(): void {
    if (this.uploading()) return;
    this.uploadModalOpen.set(false);
    this.uploadError.set(null);
  }

  kindLabelKey(kind: ProjectDocumentKind): string {
    return kind === 'PURCHASE_ORDER'
      ? 'ADMIN_FILES_PAGE.KIND_PURCHASE_ORDER'
      : 'ADMIN_FILES_PAGE.KIND_WORK_ORDER';
  }

  private downloadFileName(file: AdminFileListItem): string {
    const base = file.title.trim() || 'document';
    return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
  }

  private loadDashboard(): void {
    this.loading.set(true);
    this.api
      .getAdminDashboard(null)
      .pipe(take(1))
      .subscribe({
        next: (d) => {
          this.data.set(d);
          this.loading.set(false);
          const cur = this.selectedProjectId();
          const exists = cur && d.projects.some((p) => p.id === cur);
          if (!exists && d.projects[0]) {
            this.selectedProjectId.set(d.projects[0].id);
          }
        },
        error: () => this.loading.set(false),
      });
  }

  setUploadMode(mode: 'existing' | 'new'): void {
    this.uploadMode.set(mode);
    this.uploadError.set(null);
    this.uploadOk.set(false);
  }

  onProjectSelect(value: string): void {
    this.selectedProjectId.set(value);
    this.uploadError.set(null);
  }

  onDocKindSelect(value: string): void {
    this.docKind.set(value === 'PURCHASE_ORDER' ? 'PURCHASE_ORDER' : 'WORK_ORDER');
  }

  submitUpload(): void {
    const input = this.docFile()?.nativeElement;
    const file = input?.files?.[0];
    this.uploadError.set(null);
    this.uploadOk.set(false);

    if (!file) {
      this.uploadError.set('ADMIN_FILES_PAGE.UPLOAD_ERR_NO_FILE');
      return;
    }

    const kind = this.docKind();
    const title = this.uploadTitle().trim();
    const reference = this.uploadReference().trim();

    this.uploading.set(true);

    if (this.uploadMode() === 'new') {
      const name = this.newProjectName().trim();
      if (name.length < 2) {
        this.uploading.set(false);
        this.uploadError.set('ADMIN_FILES_PAGE.UPLOAD_ERR_BAD_NAME');
        return;
      }
      this.api
        .postPlanningDraft(name)
        .pipe(
          switchMap((proj) =>
            this.api
              .postProjectDocument(proj.id, file, {
                kind,
                title: title || undefined,
                reference: reference || undefined,
              })
              .pipe(map(() => proj.id)),
          ),
          finalize(() => this.uploading.set(false)),
          take(1),
        )
        .subscribe({
          next: (newProjectId) => {
            this.uploadOk.set(true);
            this.newProjectName.set('');
            this.uploadTitle.set('');
            this.uploadReference.set('');
            this.selectedProjectId.set(newProjectId);
            this.projectFilter.set(newProjectId);
            if (input) input.value = '';
            this.setUploadMode('existing');
            this.loadDashboard();
          },
          error: (err) => this.uploadError.set(this.errKey(err)),
        });
      return;
    }

    const projectId = this.selectedProjectId();
    if (!projectId) {
      this.uploading.set(false);
      this.uploadError.set('ADMIN_FILES_PAGE.UPLOAD_ERR_NO_PROJECT');
      return;
    }

    this.api
      .postProjectDocument(projectId, file, {
        kind,
        title: title || undefined,
        reference: reference || undefined,
      })
      .pipe(finalize(() => this.uploading.set(false)), take(1))
      .subscribe({
        next: () => {
          this.uploadOk.set(true);
          this.uploadTitle.set('');
          this.uploadReference.set('');
          if (input) input.value = '';
          this.loadDashboard();
        },
        error: (err) => this.uploadError.set(this.errKey(err)),
      });
  }

  private errKey(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const msg =
        typeof err.error === 'object' && err.error && 'message' in err.error
          ? String((err.error as { message: unknown }).message)
          : err.message;
      if (/pdf/i.test(msg)) return 'ADMIN_FILES_PAGE.UPLOAD_ERR_PDF';
      if (err.status === 413) return 'ADMIN_FILES_PAGE.UPLOAD_ERR_TOO_LARGE';
      if (err.status === 404) return 'ADMIN_FILES_PAGE.UPLOAD_ERR_NOT_FOUND';
    }
    return 'ADMIN_FILES_PAGE.UPLOAD_ERR_GENERIC';
  }
}
