import { Pipe, PipeTransform } from '@angular/core';
import {
  stationLabelKey,
  StationVariantOrder,
} from '../core/station-presentation';

@Pipe({ name: 'stationLabel', standalone: true, pure: true })
export class StationLabelPipe implements PipeTransform {
  transform(
    stationId: number,
    order?: StationVariantOrder | null,
  ): string {
    return stationLabelKey(order, stationId);
  }
}
