import { Component } from '@angular/core';
import { BomItemDto } from '../plan-upload/plan-upload.service';
import { ItemCardComponent } from '../plan-upload/item-card.component';

/**
 * Static preview page for the item card design — uses hardcoded sample data
 * and a local sample drawing, so the design can be reviewed without uploading
 * a PDF (no tokens consumed). Route: /admin/card-demo
 */
@Component({
  selector: 'skyflow-card-demo',
  standalone: true,
  imports: [ItemCardComponent],
  template: `
    <div
      dir="rtl"
      class="mx-auto grid w-full max-w-[920px] items-stretch gap-4 py-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      @for (item of sampleItems; track item.sku) {
        <skyflow-item-card [item]="item" [imageUrl]="sampleImage" />
      }
    </div>
  `,
})
export class CardDemoComponent {
  readonly sampleImage = '/assets/card/sample-drawing.svg';

  readonly sampleItems: BomItemDto[] = [
    {
      description: 'פרופיל אד און',
      drawingImageUrl: '',
      sku: 'RP927052',
      units: '231',
      meters: '6.00',
      shade: 'Steel hot-dip coated',
      supplier: 'RP Technik',
      unitPrice: '',
      totalCost: '',
      invoice: '',
    },
    {
      description: 'אטם חדש',
      drawingImageUrl: '',
      sku: 'RP812204',
      units: '40',
      meters: '',
      shade: '',
      supplier: 'RP Technik',
      unitPrice: '',
      totalCost: '',
      invoice: '',
    },
    {
      description: 'זכוכית בידודית כפולה לחזית מסך',
      drawingImageUrl: '',
      sku: 'GL-4410',
      units: '12',
      meters: '18.50',
      shade: 'Clear / Low-E',
      supplier: 'Phoenicia Glass Works',
      unitPrice: '',
      totalCost: '',
      invoice: '',
    },
  ];
}
