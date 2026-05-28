import { PlanningDraftListItemDto } from '../../../core/skyflow.models';

export type PlanningDraftViewMode = 'cards' | 'rows';

export function planningDraftStepLabelKey(d: PlanningDraftListItemDto): string {
  if (d.wizardStep === 3) return 'PLANNING_NEW.WIZARD_STEP3_SHORT';
  return 'PLANNING_NEW.WIZARD_STEP2_SHORT';
}
