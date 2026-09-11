import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Hash, Megaphone, MessageSquare, Mic, Plus, Search, X } from "lucide-react";
import type { GuildChannel, GuildRole } from "@bambot/shared";
import { useGuildMeta } from "../lib/guild-context";

const channelIcon = (type: GuildChannel["type"]) => {
  switch (type) {
    case "voice":
    case "stage":
      return Mic;
    case "forum":
      return MessageSquare;
    case "announcement":
      return Megaphone;
    default:
      return Hash;
  }
};

/** Closes a dropdown when the user clicks anywhere else. */
const useClickOutside = (onClose: () => void) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
};

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const ChannelSelect = ({
  value,
  onChange,
  types,
  allowEmpty = true,
  placeholder = "Select a channel",
}: {
  value: string;
  onChange: (value: string) => void;
  types?: GuildChannel["type"][];
  allowEmpty?: boolean;
  placeholder?: string;
}) => {
  const { meta } = useGuildMeta();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useClickOutside(() => setOpen(false));

  const allowed = types?.length ? types : (["text", "announcement"] as GuildChannel["type"][]);
  const channels = useMemo(
    () =>
      (meta?.channels ?? [])
        .filter((channel) => allowed.includes(channel.type))
        .filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())),
    [meta, allowed, query],
  );

  const selected = meta?.channels.find((c) => c.id === value);
  const Icon = selected ? channelIcon(selected.type) : Hash;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between text-left">
        <span className={clsx("flex min-w-0 items-center gap-2", !selected && "text-ink-500")}>
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{selected ? selected.name : value ? `Unknown channel (${value})` : placeholder}</span>
          {selected && !selected.writable && (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">no access</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-850 shadow-panel">
          <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-ink-500" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search channels"
              className="w-full bg-transparent text-sm outline-none placeholder:text-ink-500"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {allowEmpty && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-400 hover:bg-ink-800"
              >
                <X className="h-3.5 w-3.5" /> None
              </button>
            )}
            {channels.map((channel) => {
              const ItemIcon = channelIcon(channel.type);
              return (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => {
                    onChange(channel.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-200 hover:bg-ink-800"
                >
                  <ItemIcon className="h-3.5 w-3.5 shrink-0 text-ink-500" />
                  <span className="truncate">{channel.name}</span>
                  {!channel.writable && <span className="ml-auto text-[10px] text-amber-400">no access</span>}
                  {channel.id === value && <Check className="ml-auto h-3.5 w-3.5 text-brand-400" />}
                </button>
              );
            })}
            {!channels.length && <p className="px-3 py-4 text-center text-xs text-ink-500">No channels match.</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export const ChannelMultiSelect = ({
  value,
  onChange,
  types,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  types?: GuildChannel["type"][];
}) => {
  const { meta } = useGuildMeta();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useClickOutside(() => setOpen(false));

  const allowed = types?.length ? types : (["text", "announcement", "forum", "voice"] as GuildChannel["type"][]);
  const channels = (meta?.channels ?? [])
    .filter((c) => allowed.includes(c.type))
    .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="relative" ref={ref}>
      <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-2 py-1.5">
        {value.map((id) => {
          const channel = meta?.channels.find((c) => c.id === id);
          return (
            <span key={id} className="chip">
              <Hash className="h-3 w-3" />
              {channel?.name ?? id}
              <button type="button" onClick={() => toggle(id)} className="text-ink-400 hover:text-ink-100">
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <button type="button" onClick={() => setOpen((o) => !o)} className="chip border-dashed text-ink-400 hover:text-ink-100">
          <Plus className="h-3 w-3" /> Add channel
        </button>
      </div>

      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-850 shadow-panel">
          <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-ink-500" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search channels"
              className="w-full bg-transparent text-sm outline-none placeholder:text-ink-500"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {channels.map((channel) => (
              <button
                key={channel.id}
                type="button"
                onClick={() => toggle(channel.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-200 hover:bg-ink-800"
              >
                <Hash className="h-3.5 w-3.5 shrink-0 text-ink-500" />
                <span className="truncate">{channel.name}</span>
                {value.includes(channel.id) && <Check className="ml-auto h-3.5 w-3.5 text-brand-400" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const RoleDot = ({ role }: { role?: GuildRole }) => (
  <span
    className="h-2.5 w-2.5 shrink-0 rounded-full"
    style={{ backgroundColor: role && role.color !== "#000000" ? role.color : "#94a3b8" }}
  />
);

export const RoleSelect = ({
  value,
  onChange,
  placeholder = "Select a role",
  allowEmpty = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
}) => {
  const { meta } = useGuildMeta();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useClickOutside(() => setOpen(false));

  const roles = (meta?.roles ?? []).filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));
  const selected = meta?.roles.find((r) => r.id === value);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between text-left">
        <span className={clsx("flex min-w-0 items-center gap-2", !selected && "text-ink-500")}>
          {selected && <RoleDot role={selected} />}
          <span className="truncate">{selected ? selected.name : value ? `Unknown role (${value})` : placeholder}</span>
          {selected && !selected.assignable && (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">above me</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-850 shadow-panel">
          <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-ink-500" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search roles"
              className="w-full bg-transparent text-sm outline-none placeholder:text-ink-500"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {allowEmpty && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-400 hover:bg-ink-800"
              >
                <X className="h-3.5 w-3.5" /> None
              </button>
            )}
            {roles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => {
                  onChange(role.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-200 hover:bg-ink-800"
              >
                <RoleDot role={role} />
                <span className="truncate">{role.name}</span>
                {!role.assignable && <span className="ml-auto shrink-0 text-[10px] text-amber-400">above me</span>}
                {role.id === value && <Check className="ml-auto h-3.5 w-3.5 text-brand-400" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const RoleMultiSelect = ({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) => {
  const { meta } = useGuildMeta();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useClickOutside(() => setOpen(false));

  const roles = (meta?.roles ?? []).filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="relative" ref={ref}>
      <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-2 py-1.5">
        {value.map((id) => {
          const role = meta?.roles.find((r) => r.id === id);
          return (
            <span key={id} className="chip">
              <RoleDot role={role} />
              {role?.name ?? id}
              <button type="button" onClick={() => toggle(id)} className="text-ink-400 hover:text-ink-100">
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <button type="button" onClick={() => setOpen((o) => !o)} className="chip border-dashed text-ink-400 hover:text-ink-100">
          <Plus className="h-3 w-3" /> Add role
        </button>
      </div>

      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-850 shadow-panel">
          <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-ink-500" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search roles"
              className="w-full bg-transparent text-sm outline-none placeholder:text-ink-500"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {roles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => toggle(role.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-200 hover:bg-ink-800"
              >
                <RoleDot role={role} />
                <span className="truncate">{role.name}</span>
                {value.includes(role.id) && <Check className="ml-auto h-3.5 w-3.5 text-brand-400" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Misc inputs
// ---------------------------------------------------------------------------

export const ColorInput = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#00AE42";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={safe}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        className="h-10 w-12 cursor-pointer rounded-lg border border-ink-700 bg-ink-850 p-1"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        className="input font-mono uppercase"
        maxLength={7}
        spellCheck={false}
      />
    </div>
  );
};

export const StringListInput = ({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) => {
  const [draft, setDraft] = useState("");

  const add = () => {
    const entries = draft
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.includes(s));
    if (entries.length) onChange([...value, ...entries]);
    setDraft("");
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder={placeholder ?? "Type and press Enter"}
          className="input"
        />
        <button type="button" onClick={add} className="btn-secondary shrink-0">
          Add
        </button>
      </div>
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((entry) => (
            <span key={entry} className="chip font-mono">
              {entry}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== entry))}
                className="text-ink-400 hover:text-ink-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export const MultiSelectInput = ({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: { value: string; label: string; description?: string }[];
}) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map((option) => {
      const active = value.includes(option.value);
      return (
        <button
          key={option.value}
          type="button"
          title={option.description}
          onClick={() => onChange(active ? value.filter((v) => v !== option.value) : [...value, option.value])}
          className={clsx(
            "rounded-lg border px-2.5 py-1.5 text-xs transition",
            active
              ? "border-brand-500/60 bg-brand-500/15 text-brand-200"
              : "border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600 hover:text-ink-100",
          )}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

/** Seconds in, seconds out — but presented in whatever unit reads best. */
export const DurationInput = ({ value, onChange }: { value: number; onChange: (seconds: number) => void }) => {
  const units = [
    { label: "seconds", factor: 1 },
    { label: "minutes", factor: 60 },
    { label: "hours", factor: 3600 },
    { label: "days", factor: 86400 },
  ];

  const best = [...units].reverse().find((u) => value >= u.factor && value % u.factor === 0) ?? units[0];
  const [unit, setUnit] = useState(best.factor);
  const amount = Math.round(value / unit) || 0;

  return (
    <div className="flex gap-2">
      <input
        type="number"
        min={0}
        value={amount}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0) * unit)}
        className="input w-28"
      />
      <select
        value={unit}
        onChange={(event) => {
          const next = Number(event.target.value);
          setUnit(next);
          onChange(amount * next);
        }}
        className="input w-32"
      >
        {units.map((u) => (
          <option key={u.factor} value={u.factor}>
            {u.label}
          </option>
        ))}
      </select>
    </div>
  );
};
