export type UiSelectSize = 'md' | 'lg' | 'touch' | 'hero';

export interface UiSelectOption<T = string | number | null> {
  value: T;
  label: string;
  disabled?: boolean;
}
