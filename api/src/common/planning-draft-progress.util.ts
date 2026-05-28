/** שלבי אשף תכנון (1=שם — לא מופיע ברשימה, 2=קובץ, 3=שיבוץ ואישור) */
export function planningDraftWizardMeta(itemCount: number): {
  wizardStep: 2 | 3;
  progressPct: number;
} {
  const wizardStep: 2 | 3 = itemCount > 0 ? 3 : 2;
  const progressPct = Math.round((wizardStep / 3) * 100);
  return { wizardStep, progressPct };
}
