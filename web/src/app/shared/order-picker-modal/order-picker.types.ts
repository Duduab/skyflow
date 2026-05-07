/** סיכום התקדמות קו לפי הזמנה (מודאל בחירה). */
export interface OrderPickerPreview {
  averagePct: number;
  stationsComplete: number;
  /** הושלם לפי סטטוס ERP או קו מלא */
  lineDone: boolean;
}
