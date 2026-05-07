import { Component, Input, booleanAttribute } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/** Loader להצגה בזמן טעינת הקשרים לכל תחנות הפרויקט */
@Component({
  selector: 'skyflow-stations-loader',
  imports: [TranslateModule],
  templateUrl: './stations-loader.component.html',
  styleUrl: './stations-loader.component.scss',
  host: {
    '[class.stations-loader-host--live]': 'live',
  },
})
export class StationsLoaderComponent {
  readonly stationNums = [1, 2, 3, 4, 5, 6, 7] as const;

  /** תצוגה חיה — סקלטון דמוי כרטיסי התחנות במקום רק תאים קטנים */
  @Input({ transform: booleanAttribute }) live = false;

  readonly stationRows: readonly (readonly number[])[] = [
    [1, 2],
    [3, 4],
    [5, 6],
    [7],
  ];
}
