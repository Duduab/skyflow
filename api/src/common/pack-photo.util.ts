/** Station 6 — כמה תמונות תיעוד נדרשות לפי גודל ההזמנה */
export function packPhotoRequiredCount(totalItems: number): number {
  if (!Number.isFinite(totalItems) || totalItems <= 0) return 3;
  return Math.min(8, Math.max(3, Math.ceil(totalItems / 10)));
}

/** מקסימום משבצות (נדרשות + אופציונליות) */
export const MAX_PACK_PHOTO_SLOTS = 24;
