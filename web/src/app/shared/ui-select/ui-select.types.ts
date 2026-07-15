export type UiSelectSize = 'md' | 'lg' | 'touch' | 'hero';

/** Optional rich label: `leading` + bold colored `emphasis` + `trailing`. */
export interface UiSelectLabelParts {
  leading: string;
  emphasis: string;
  trailing: string;
}

export interface UiSelectOption<T = string | number | null> {
  value: T;
  label: string;
  disabled?: boolean;
  labelParts?: UiSelectLabelParts;
}
