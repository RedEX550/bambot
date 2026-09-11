import clsx from "clsx";
import type { FieldSection, FieldSpec, MessagePayload } from "@bambot/shared";
import { Card, Field, Select, TextArea, TextInput, Toggle } from "./ui";
import {
  ChannelMultiSelect,
  ChannelSelect,
  ColorInput,
  DurationInput,
  MultiSelectInput,
  RoleMultiSelect,
  RoleSelect,
  StringListInput,
} from "./pickers";
import { EmbedEditor } from "./EmbedEditor";

// ---------------------------------------------------------------------------
// Dot-path helpers
// ---------------------------------------------------------------------------

export const getPath = (object: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object") return (current as Record<string, unknown>)[key];
    return undefined;
  }, object);

/** Immutable set — React state must never be mutated in place. */
export const setPath = <T,>(object: T, path: string, value: unknown): T => {
  const keys = path.split(".");
  const clone: Record<string, unknown> = { ...(object as Record<string, unknown>) };
  let cursor = clone;

  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const next = cursor[key];
    cursor[key] = next && typeof next === "object" && !Array.isArray(next) ? { ...(next as object) } : {};
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[keys[keys.length - 1]] = value;
  return clone as T;
};

const shouldShow = (field: FieldSpec, data: unknown): boolean => {
  if (!field.showIf) return true;
  const current = getPath(data, field.showIf.path);
  if (field.showIf.truthy !== undefined) return Boolean(current) === field.showIf.truthy;
  if (field.showIf.equals !== undefined) return current === field.showIf.equals;
  return true;
};

// ---------------------------------------------------------------------------
// Field renderer
// ---------------------------------------------------------------------------

export interface CustomFieldProps {
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  data: unknown;
}

export const FieldRenderer = ({
  field,
  data,
  onChange,
  custom,
}: {
  field: FieldSpec;
  data: unknown;
  onChange: (path: string, value: unknown) => void;
  custom?: Record<string, (props: CustomFieldProps) => JSX.Element>;
}) => {
  const value = getPath(data, field.path);
  const set = (next: unknown) => onChange(field.path, next);

  if (field.kind === "custom") {
    const Component = field.component ? custom?.[field.component] : undefined;
    if (!Component) {
      return (
        <Field label={field.label} hint={field.description}>
          <p className="rounded-lg border border-dashed border-ink-700 px-3 py-3 text-xs text-ink-500">
            This setting is edited on its own page.
          </p>
        </Field>
      );
    }
    return <Component field={field} value={value} onChange={set} data={data} />;
  }

  switch (field.kind) {
    case "toggle":
      return <Toggle checked={Boolean(value)} onChange={set} label={field.label} description={field.description} />;

    case "text":
    case "url":
      return (
        <Field label={field.label} hint={field.description}>
          <TextInput
            value={String(value ?? "")}
            placeholder={field.placeholder}
            onChange={(event) => set(event.target.value)}
          />
        </Field>
      );

    case "textarea":
      return (
        <Field label={field.label} hint={field.description}>
          <TextArea
            value={String(value ?? "")}
            placeholder={field.placeholder}
            onChange={(event) => set(event.target.value)}
          />
        </Field>
      );

    case "number":
      return (
        <Field label={field.label} hint={field.description}>
          <TextInput
            type="number"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={Number(value ?? 0)}
            onChange={(event) => set(Number(event.target.value))}
          />
        </Field>
      );

    case "slider":
      return (
        <Field label={field.label} hint={field.description}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={field.min ?? 0}
              max={field.max ?? 100}
              step={field.step ?? 1}
              value={Number(value ?? 0)}
              onChange={(event) => set(Number(event.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-700 accent-brand-500"
            />
            <span className="w-14 shrink-0 rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-center text-xs tabular-nums">
              {String(value ?? 0)}
            </span>
          </div>
        </Field>
      );

    case "select":
      return (
        <Field label={field.label} hint={field.description}>
          <Select value={String(value ?? "")} onChange={set} options={field.options ?? []} />
        </Field>
      );

    case "multiselect":
      return (
        <Field label={field.label} hint={field.description}>
          <MultiSelectInput value={(value as string[]) ?? []} onChange={set} options={field.options ?? []} />
        </Field>
      );

    case "channel":
      return (
        <Field label={field.label} hint={field.description}>
          <ChannelSelect value={String(value ?? "")} onChange={set} types={field.channelTypes} />
        </Field>
      );

    case "channels":
      return (
        <Field label={field.label} hint={field.description}>
          <ChannelMultiSelect value={(value as string[]) ?? []} onChange={set} types={field.channelTypes} />
        </Field>
      );

    case "role":
      return (
        <Field label={field.label} hint={field.description}>
          <RoleSelect value={String(value ?? "")} onChange={set} />
        </Field>
      );

    case "roles":
      return (
        <Field label={field.label} hint={field.description}>
          <RoleMultiSelect value={(value as string[]) ?? []} onChange={set} />
        </Field>
      );

    case "color":
      return (
        <Field label={field.label} hint={field.description}>
          <ColorInput value={String(value ?? "#00AE42")} onChange={set} />
        </Field>
      );

    case "duration":
      return (
        <Field label={field.label} hint={field.description}>
          <DurationInput value={Number(value ?? 0)} onChange={set} />
        </Field>
      );

    case "stringlist":
      return (
        <Field label={field.label} hint={field.description}>
          <StringListInput value={(value as string[]) ?? []} onChange={set} placeholder={field.placeholder} />
        </Field>
      );

    case "message":
      return (
        <Field label={field.label} hint={field.description}>
          <EmbedEditor
            value={value as MessagePayload}
            onChange={set}
            scopes={field.scopes ?? ["member", "guild"]}
          />
        </Field>
      );

    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// Section renderer
// ---------------------------------------------------------------------------

/**
 * Renders a module's sections from its field specs.
 *
 * Half-width fields are paired into a two-column grid, so a page of toggles and
 * short numbers does not become a mile-long single column.
 */
export const AutoFormSection = ({
  section,
  data,
  onChange,
  custom,
}: {
  section: FieldSection;
  data: unknown;
  onChange: (path: string, value: unknown) => void;
  custom?: Record<string, (props: CustomFieldProps) => JSX.Element>;
}) => {
  const visible = section.fields.filter((field) => shouldShow(field, data));
  if (!visible.length) return null;

  // Group consecutive half-width fields so they share a row.
  const rows: FieldSpec[][] = [];
  for (const field of visible) {
    const last = rows[rows.length - 1];
    if (field.width === "half" && last && last.length === 1 && last[0].width === "half") {
      last.push(field);
    } else {
      rows.push([field]);
    }
  }

  return (
    <Card title={section.title} description={section.description}>
      <div className="space-y-5">
        {rows.map((row, index) => (
          <div key={index} className={clsx(row.length > 1 && "grid gap-5 sm:grid-cols-2")}>
            {row.map((field) => (
              <FieldRenderer key={field.path} field={field} data={data} onChange={onChange} custom={custom} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
};

export const AutoForm = ({
  sections,
  data,
  onChange,
  custom,
}: {
  sections: FieldSection[];
  data: unknown;
  onChange: (path: string, value: unknown) => void;
  custom?: Record<string, (props: CustomFieldProps) => JSX.Element>;
}) => (
  <div className="space-y-5">
    {sections.map((section) => (
      <AutoFormSection key={section.id} section={section} data={data} onChange={onChange} custom={custom} />
    ))}
  </div>
);

export default AutoForm;
