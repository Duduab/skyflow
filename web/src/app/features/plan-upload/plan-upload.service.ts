import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface BomItemDto {
  description: string;
  drawingImageUrl: string;
  sku: string;
  units: string;
  meters: string;
  shade: string;
  supplier: string;
  unitPrice: string;
  totalCost: string;
  invoice: string;
}

export interface PlanHeaderDto {
  partNumber: string;
  systemType: string;
  orderNumber: string;
  date: string;
}

export interface BomDataDto {
  projectName: string;
  header: PlanHeaderDto;
  items: BomItemDto[];
  extractionMethod: 'pdf_grid' | 'ai';
}

export interface PlanUploadResponseDto {
  id: string;
  projectName: string;
  s3Url: string;
  bomData: BomDataDto;
  createdAt: string;
}

export interface DrawingPreviewDto {
  url: string;
  expiresInSec: number;
}

@Injectable({ providedIn: 'root' })
export class PlanUploadService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/pdf-analysis';

  uploadPlan(file: File): Observable<PlanUploadResponseDto> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<PlanUploadResponseDto>(`${this.base}/upload`, formData);
  }

  savePurchaseOrder(payload: {
    projectName: string;
    s3Url: string;
    bomData: BomDataDto;
  }): Observable<PlanUploadResponseDto> {
    return this.http.post<PlanUploadResponseDto>(`${this.base}/orders`, payload);
  }

  listPurchaseOrders(): Observable<PlanUploadResponseDto[]> {
    return this.http.get<PlanUploadResponseDto[]>(`${this.base}/orders`);
  }

  getDrawingPreview(objectUrl: string): Observable<DrawingPreviewDto> {
    return this.http.post<DrawingPreviewDto>(`${this.base}/drawing-preview`, {
      objectUrl,
    });
  }
}
