import type { AcceptableValue } from "reka-ui";

export interface ComboboxOption {
  value: AcceptableValue;
  label: string;
  disabled?: boolean;
}

export { default as Combobox } from "./Combobox.vue";
