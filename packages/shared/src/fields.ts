/**
 * UI field descriptors.
 *
 * Each config module ships a schema (validation, used by the API) *and* a list
 * of sections/fields (presentation, used by the dashboard). They live in the
 * same file so a new setting cannot be added to one without the other.
 */

import type { PlaceholderScope } from "./placeholders";

export type FieldKind =
  | "toggle"
  | "text"
  | "textarea"
  | "number"
  | "slider"
  | "select"
  | "multiselect"
  | "channel"
  | "channels"
  | "role"
  | "roles"
  | "color"
  | "duration"
  | "url"
  | "stringlist"
  | "message"
  | "custom";

export interface FieldOption {
  value: string;
  label: string;
  description?: string;
}

export interface FieldSpec {
  /** Dot path into the module config object, e.g. "card.background". */
  path: string;
  label: string;
  kind: FieldKind;
  description?: string;
  placeholder?: string;
  options?: FieldOption[];
  min?: number;
  max?: number;
  step?: number;
  /** Only show this field when another path is truthy / equals a value. */
  showIf?: { path: string; equals?: unknown; truthy?: boolean };
  /** Which placeholder scopes are valid inside this text field. */
  scopes?: PlaceholderScope[];
  /** Channel type filter for channel pickers. */
  channelTypes?: ("text" | "voice" | "category" | "forum" | "announcement" | "stage")[];
  /** Renders a named bespoke component instead of a generic input. */
  component?: string;
  width?: "full" | "half";
  badge?: string;
}

export interface FieldSection {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  fields: FieldSpec[];
  /** Hide the whole section unless the module is enabled. */
  requiresEnabled?: boolean;
}

export interface ModuleUi {
  /** Sidebar label. */
  title: string;
  /** One-line explanation shown under the page heading. */
  description: string;
  icon: string;
  /** Sidebar grouping. */
  group: "General" | "Moderation" | "Support" | "Community" | "Bambu Lab";
  sections: FieldSection[];
  /** Optional bespoke page component that replaces the generic renderer. */
  customPage?: string;
}
