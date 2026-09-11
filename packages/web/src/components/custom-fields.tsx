import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { CustomFieldProps } from "./AutoForm";
import { Field, Select, TextInput } from "./ui";
import { ChannelSelect, RoleSelect } from "./pickers";

/**
 * A small framework for the "list of little objects" settings — escalation
 * tiers, level rewards, bonus entries and so on. They all need the same
 * add / remove / edit-a-row behaviour, so it lives in one place.
 */
const ArrayEditor = <T,>({
  label,
  description,
  items,
  onChange,
  makeNew,
  renderRow,
  addLabel = "Add",
  max = 25,
  empty,
}: {
  label: string;
  description?: string;
  items: T[];
  onChange: (items: T[]) => void;
  makeNew: () => T;
  renderRow: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
  addLabel?: string;
  max?: number;
  empty?: string;
}) => (
  <Field label={label} hint={description}>
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-900/60 p-3">
          <div className="min-w-0 flex-1">
            {renderRow(
              item,
              (patch) => onChange(items.map((current, i) => (i === index ? { ...current, ...patch } : current))),
              index,
            )}
          </div>
          <button
            type="button"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
            className="btn-ghost mt-0.5 h-8 w-8 shrink-0 p-0 text-ink-500 hover:text-red-300"
            aria-label="Remove"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      {!items.length && empty && (
        <p className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-center text-xs text-ink-500">{empty}</p>
      )}

      {items.length < max && (
        <button
          type="button"
          onClick={() => onChange([...items, makeNew()])}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-700 py-2.5 text-xs text-ink-400 transition hover:border-brand-500/50 hover:text-brand-300"
        >
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </button>
      )}
    </div>
  </Field>
);

const ACTION_OPTIONS = [
  { value: "none", label: "Log only" },
  { value: "delete", label: "Delete message" },
  { value: "warn", label: "Warn" },
  { value: "timeout", label: "Timeout" },
  { value: "quarantine", label: "Quarantine" },
  { value: "kick", label: "Kick" },
  { value: "ban", label: "Ban" },
];

interface Tier {
  points: number;
  action: string;
  timeoutSeconds: number;
}

const EscalationEditor = ({ field, value, onChange }: CustomFieldProps) => (
  <ArrayEditor<Tier>
    label={field.label}
    description="Sorted by points. The highest tier a member crosses is the one that fires."
    items={((value as Tier[]) ?? []).slice().sort((a, b) => a.points - b.points)}
    onChange={(items) => onChange(items)}
    makeNew={() => ({ points: 5, action: "timeout", timeoutSeconds: 3600 })}
    addLabel="Add a tier"
    empty="No tiers — filters will act on their own without escalating."
    renderRow={(item, update) => (
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="At points">
          <TextInput
            type="number"
            min={1}
            value={item.points}
            onChange={(event) => update({ points: Number(event.target.value) })}
          />
        </Field>
        <Field label="Action">
          <Select value={item.action} onChange={(action) => update({ action })} options={ACTION_OPTIONS} />
        </Field>
        {item.action === "timeout" && (
          <Field label="Timeout (minutes)">
            <TextInput
              type="number"
              min={1}
              value={Math.round(item.timeoutSeconds / 60)}
              onChange={(event) => update({ timeoutSeconds: Math.max(1, Number(event.target.value)) * 60 })}
            />
          </Field>
        )}
      </div>
    )}
  />
);

interface Threshold {
  count: number;
  action: string;
  durationSeconds: number;
}

const WarnThresholdEditor = ({ field, value, onChange }: CustomFieldProps) => (
  <ArrayEditor<Threshold>
    label={field.label}
    description="Fires when a member reaches exactly this many active warnings."
    items={((value as Threshold[]) ?? []).slice().sort((a, b) => a.count - b.count)}
    onChange={onChange}
    makeNew={() => ({ count: 3, action: "timeout", durationSeconds: 86400 })}
    addLabel="Add a threshold"
    empty="No automatic punishments. Warns will only be recorded."
    renderRow={(item, update) => (
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Warnings">
          <TextInput
            type="number"
            min={1}
            value={item.count}
            onChange={(event) => update({ count: Number(event.target.value) })}
          />
        </Field>
        <Field label="Action">
          <Select
            value={item.action}
            onChange={(action) => update({ action })}
            options={[
              { value: "none", label: "Nothing" },
              { value: "timeout", label: "Timeout" },
              { value: "kick", label: "Kick" },
              { value: "ban", label: "Ban" },
            ]}
          />
        </Field>
        {item.action === "timeout" && (
          <Field label="Duration (hours)">
            <TextInput
              type="number"
              min={1}
              value={Math.round(item.durationSeconds / 3600)}
              onChange={(event) => update({ durationSeconds: Math.max(1, Number(event.target.value)) * 3600 })}
            />
          </Field>
        )}
      </div>
    )}
  />
);

interface LevelReward {
  level: number;
  roleId: string;
  removePrevious: boolean;
}

const LevelRewardsEditor = ({ field, value, onChange }: CustomFieldProps) => (
  <ArrayEditor<LevelReward>
    label={field.label}
    description="Granted automatically when a member reaches the level."
    items={((value as LevelReward[]) ?? []).slice().sort((a, b) => a.level - b.level)}
    onChange={onChange}
    makeNew={() => ({ level: 5, roleId: "", removePrevious: true })}
    addLabel="Add a reward"
    empty="No level rewards configured."
    renderRow={(item, update) => (
      <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
        <Field label="At level">
          <TextInput
            type="number"
            min={1}
            value={item.level}
            onChange={(event) => update({ level: Number(event.target.value) })}
          />
        </Field>
        <Field label="Role">
          <RoleSelect value={item.roleId} onChange={(roleId) => update({ roleId })} />
        </Field>
      </div>
    )}
  />
);

interface Multiplier {
  type: "role" | "channel";
  id: string;
  factor: number;
}

const MultiplierEditor = ({ field, value, onChange }: CustomFieldProps) => (
  <ArrayEditor<Multiplier>
    label={field.label}
    description="Multiply XP earned in a channel or by members with a role."
    items={(value as Multiplier[]) ?? []}
    onChange={onChange}
    makeNew={() => ({ type: "role", id: "", factor: 2 })}
    addLabel="Add a multiplier"
    empty="Everyone earns XP at the base rate."
    renderRow={(item, update) => (
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Applies to">
          <Select
            value={item.type}
            onChange={(type) => update({ type: type as "role" | "channel", id: "" })}
            options={[
              { value: "role", label: "A role" },
              { value: "channel", label: "A channel" },
            ]}
          />
        </Field>
        <Field label={item.type === "role" ? "Role" : "Channel"}>
          {item.type === "role" ? (
            <RoleSelect value={item.id} onChange={(id) => update({ id })} />
          ) : (
            <ChannelSelect value={item.id} onChange={(id) => update({ id })} />
          )}
        </Field>
        <Field label="Multiplier">
          <TextInput
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={item.factor}
            onChange={(event) => update({ factor: Number(event.target.value) })}
          />
        </Field>
      </div>
    )}
  />
);

const RangeEditor = ({ field, value, onChange }: CustomFieldProps) => {
  const range = (value as [number, number]) ?? [15, 25];
  return (
    <Field label={field.label} hint="A random amount in this range is awarded per message.">
      <div className="flex items-center gap-2">
        <TextInput
          type="number"
          min={0}
          value={range[0]}
          onChange={(event) => onChange([Number(event.target.value), range[1]])}
        />
        <span className="text-sm text-ink-500">to</span>
        <TextInput
          type="number"
          min={0}
          value={range[1]}
          onChange={(event) => onChange([range[0], Number(event.target.value)])}
        />
      </div>
    </Field>
  );
};

interface Counter {
  channelId: string;
  template: string;
  metric: string;
  roleId: string;
  enabled: boolean;
}

const CounterEditor = ({ field, value, onChange }: CustomFieldProps) => (
  <ArrayEditor<Counter>
    label={field.label}
    description="Use {count} in the template — it is replaced with the metric value."
    items={(value as Counter[]) ?? []}
    onChange={onChange}
    makeNew={() => ({ channelId: "", template: "Members: {count}", metric: "members", roleId: "", enabled: true })}
    addLabel="Add a counter"
    max={10}
    empty="No stat channels yet."
    renderRow={(item, update) => (
      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Channel">
            <ChannelSelect
              value={item.channelId}
              onChange={(channelId) => update({ channelId })}
              types={["voice", "category", "text"]}
            />
          </Field>
          <Field label="Metric">
            <Select
              value={item.metric}
              onChange={(metric) => update({ metric })}
              options={[
                { value: "members", label: "Total members" },
                { value: "humans", label: "Humans" },
                { value: "bots", label: "Bots" },
                { value: "boosts", label: "Boosts" },
                { value: "ticketsOpen", label: "Open tickets" },
                { value: "roleCount", label: "Members with a role" },
              ]}
            />
          </Field>
        </div>
        {item.metric === "roleCount" && (
          <Field label="Role">
            <RoleSelect value={item.roleId} onChange={(roleId) => update({ roleId })} />
          </Field>
        )}
        <Field label="Name template">
          <TextInput value={item.template} onChange={(event) => update({ template: event.target.value })} />
        </Field>
      </div>
    )}
  />
);

interface BonusEntry {
  roleId: string;
  entries: number;
}

const BonusEntryEditor = ({ field, value, onChange }: CustomFieldProps) => (
  <ArrayEditor<BonusEntry>
    label={field.label}
    description="Members with the role get this many entries instead of one."
    items={(value as BonusEntry[]) ?? []}
    onChange={onChange}
    makeNew={() => ({ roleId: "", entries: 2 })}
    addLabel="Add a bonus"
    empty="Everyone gets a single entry."
    renderRow={(item, update) => (
      <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
        <Field label="Role">
          <RoleSelect value={item.roleId} onChange={(roleId) => update({ roleId })} />
        </Field>
        <Field label="Entries">
          <TextInput
            type="number"
            min={1}
            max={10}
            value={item.entries}
            onChange={(event) => update({ entries: Number(event.target.value) })}
          />
        </Field>
      </div>
    )}
  />
);

interface PrinterRole {
  model: string;
  roleId: string;
}

const PrinterRoleEditor = ({ field, value, onChange }: CustomFieldProps) => (
  <ArrayEditor<PrinterRole>
    label={field.label}
    description="Lets members self-assign the machine they own."
    items={(value as PrinterRole[]) ?? []}
    onChange={onChange}
    makeNew={() => ({ model: "", roleId: "" })}
    addLabel="Add a printer role"
    empty="No printer roles mapped yet."
    renderRow={(item, update) => (
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Model">
          <Select
            value={item.model}
            onChange={(model) => update({ model })}
            placeholder="Choose a printer"
            options={[
              { value: "a1-mini", label: "A1 mini" },
              { value: "a1", label: "A1" },
              { value: "a2l", label: "A2L" },
              { value: "p1p", label: "P1P" },
              { value: "p1s", label: "P1S" },
              { value: "p2s", label: "P2S" },
              { value: "x1c", label: "X1 Carbon" },
              { value: "x1e", label: "X1E" },
              { value: "x2d", label: "X2D" },
              { value: "h2d", label: "H2D" },
              { value: "h2s", label: "H2S" },
              { value: "h2c", label: "H2C" },
            ]}
          />
        </Field>
        <Field label="Role">
          <RoleSelect value={item.roleId} onChange={(roleId) => update({ roleId })} />
        </Field>
      </div>
    )}
  />
);

/** Everything the AutoForm can render for a `kind: "custom"` field. */
export const CUSTOM_FIELDS: Record<string, (props: CustomFieldProps) => JSX.Element> = {
  EscalationEditor,
  WarnThresholdEditor,
  LevelRewardsEditor,
  MultiplierEditor,
  RangeEditor,
  CounterEditor,
  BonusEntryEditor,
  PrinterRoleEditor,
};
