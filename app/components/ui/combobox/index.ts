import type { AcceptableValue } from "reka-ui";

export interface ComboboxOption {
  value: AcceptableValue;
  label: string;
  disabled?: boolean;
  // Secondary line under the label (e.g. a food's Arabic name).
  hint?: string;
  // Items sharing a group render under one heading, in the order the groups first appear.
  group?: string;
  // What the search box matches against; defaults to the label.
  searchText?: string;
}

export { default as Combobox } from "./Combobox.vue";
