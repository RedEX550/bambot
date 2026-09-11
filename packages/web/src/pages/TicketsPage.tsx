import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Send, Trash2 } from "lucide-react";
import type { TicketCategory, TicketPanel, TicketsConfig } from "@bambot/shared";
import { runAction } from "../lib/api";
import { useGuildMeta } from "../lib/guild-context";
import { useModuleConfig } from "../lib/use-module-config";
import { AutoFormSection } from "../components/AutoForm";
import { EmbedEditor } from "../components/EmbedEditor";
import { Alert, Badge, Card, Field, SaveBar, Select, Spinner, Tabs, TextArea, TextInput, Toggle, useToast } from "../components/ui";
import { ChannelSelect, RoleMultiSelect } from "../components/pickers";

const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "category";

const emptyPayload = () => ({ content: "", embeds: [], buttons: [], ghostPing: false, deleteAfter: 0 });

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const PanelEditor = ({
  panel,
  categories,
  onChange,
  onDelete,
  guildId,
}: {
  panel: TicketPanel;
  categories: TicketCategory[];
  onChange: (panel: TicketPanel) => void;
  onDelete: () => void;
  guildId: string;
}) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const publish = useMutation({
    mutationFn: () => runAction(guildId, "publishPanel", { panelId: panel.id }),
    onSuccess: (result) => toast.push(result.ok ? "success" : "error", result.message),
    onError: (error: unknown) =>
      toast.push("error", error instanceof Error ? error.message : "Could not publish the panel."),
  });

  const toggleCategory = (key: string) =>
    onChange({
      ...panel,
      categoryKeys: panel.categoryKeys.includes(key)
        ? panel.categoryKeys.filter((k) => k !== key)
        : [...panel.categoryKeys, key],
    });

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850/50">
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />}
          <span className="truncate text-sm font-medium text-ink-100">{panel.name}</span>
          <Badge tone={panel.channelId ? "brand" : "warning"}>
            {panel.channelId ? `${panel.categoryKeys.length} categories` : "no channel"}
          </Badge>
        </button>
        <button
          type="button"
          onClick={() => publish.mutate()}
          disabled={!panel.channelId || publish.isPending}
          className="btn-secondary text-xs"
          title="Post or refresh this panel in Discord"
        >
          {publish.isPending ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
          Publish
        </button>
        <button type="button" onClick={onDelete} className="btn-ghost h-8 w-8 p-0 text-ink-500 hover:text-red-300">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="space-y-5 border-t border-ink-700/60 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Panel name" hint="Internal only — members never see it.">
              <TextInput value={panel.name} onChange={(event) => onChange({ ...panel, name: event.target.value })} />
            </Field>
            <Field label="Channel">
              <ChannelSelect
                value={panel.channelId}
                onChange={(channelId) => onChange({ ...panel, channelId })}
                types={["text", "announcement"]}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Style" hint="A dropdown is better above about five categories.">
              <Select
                value={panel.style}
                onChange={(style) => onChange({ ...panel, style: style as TicketPanel["style"] })}
                options={[
                  { value: "buttons", label: "Buttons" },
                  { value: "select", label: "Dropdown" },
                ]}
              />
            </Field>
            {panel.style === "select" && (
              <Field label="Dropdown placeholder">
                <TextInput
                  value={panel.selectPlaceholder}
                  onChange={(event) => onChange({ ...panel, selectPlaceholder: event.target.value })}
                />
              </Field>
            )}
          </div>

          <Field label="Categories on this panel" hint="Order follows the category list below.">
            <div className="flex flex-wrap gap-1.5">
              {categories.map((category) => {
                const active = panel.categoryKeys.includes(category.key);
                return (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => toggleCategory(category.key)}
                    disabled={!category.enabled}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition disabled:opacity-40 ${
                      active
                        ? "border-brand-500/60 bg-brand-500/15 text-brand-200"
                        : "border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600"
                    }`}
                  >
                    {category.emoji} {category.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Panel message">
            <EmbedEditor
              value={panel.message}
              onChange={(message) => onChange({ ...panel, message })}
              scopes={["guild"]}
            />
          </Field>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CategoryEditor = ({
  category,
  onChange,
  onDelete,
}: {
  category: TicketCategory;
  onChange: (category: TicketCategory) => void;
  onDelete: () => void;
}) => {
  const [open, setOpen] = useState(false);

  const updateField = (index: number, patch: Partial<TicketCategory["form"][number]>) =>
    onChange({ ...category, form: category.form.map((field, i) => (i === index ? { ...field, ...patch } : field)) });

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850/50">
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />}
          <span className="shrink-0 text-base">{category.emoji}</span>
          <span className="truncate text-sm font-medium text-ink-100">{category.label}</span>
          {category.form.length > 0 && <Badge>{category.form.length} form fields</Badge>}
          {!category.enabled && <Badge tone="warning">disabled</Badge>}
        </button>
        <button type="button" onClick={onDelete} className="btn-ghost h-8 w-8 p-0 text-ink-500 hover:text-red-300">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="space-y-5 border-t border-ink-700/60 px-4 py-4">
          <Toggle
            checked={category.enabled}
            onChange={(enabled) => onChange({ ...category, enabled })}
            label="Available to members"
          />

          <div className="grid gap-4 sm:grid-cols-[80px_1fr]">
            <Field label="Emoji">
              <TextInput value={category.emoji} onChange={(event) => onChange({ ...category, emoji: event.target.value })} />
            </Field>
            <Field label="Label">
              <TextInput value={category.label} onChange={(event) => onChange({ ...category, label: event.target.value })} />
            </Field>
          </div>

          <Field label="Short description" hint="Shown under the option in a dropdown panel.">
            <TextInput
              value={category.description}
              onChange={(event) => onChange({ ...category, description: event.target.value })}
              maxLength={100}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Create channels under" hint="A Discord category.">
              <ChannelSelect
                value={category.parentCategoryId}
                onChange={(parentCategoryId) => onChange({ ...category, parentCategoryId })}
                types={["category"]}
              />
            </Field>
            <Field label="Channel name pattern" hint="{number}, {user}, {category}">
              <TextInput value={category.naming} onChange={(event) => onChange({ ...category, naming: event.target.value })} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Support roles" hint="Who can see and answer these tickets.">
              <RoleMultiSelect
                value={category.supportRoles}
                onChange={(supportRoles) => onChange({ ...category, supportRoles })}
              />
            </Field>
            <Field label="Ping on open">
              <RoleMultiSelect value={category.pingRoles} onChange={(pingRoles) => onChange({ ...category, pingRoles })} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Default priority">
              <Select
                value={category.defaultPriority}
                onChange={(defaultPriority) =>
                  onChange({ ...category, defaultPriority: defaultPriority as TicketCategory["defaultPriority"] })
                }
                options={[
                  { value: "LOW", label: "Low" },
                  { value: "NORMAL", label: "Normal" },
                  { value: "HIGH", label: "High" },
                  { value: "URGENT", label: "Urgent" },
                ]}
              />
            </Field>
            <Field label="Max open per member">
              <TextInput
                type="number"
                min={1}
                max={10}
                value={category.maxOpenPerUser}
                onChange={(event) => onChange({ ...category, maxOpenPerUser: Number(event.target.value) })}
              />
            </Field>
            <Field label="Auto-close after (hours)" hint="0 never closes.">
              <TextInput
                type="number"
                min={0}
                max={720}
                value={category.autoCloseHours}
                onChange={(event) => onChange({ ...category, autoCloseHours: Number(event.target.value) })}
              />
            </Field>
          </div>

          {/* Intake form builder */}
          <div>
            <div className="flex items-center justify-between">
              <div>
                <label className="field-label">Intake form</label>
                <p className="field-hint">
                  Shown as a modal before the ticket opens. Discord allows at most five fields.
                </p>
              </div>
              <button
                type="button"
                disabled={category.form.length >= 5}
                onClick={() =>
                  onChange({
                    ...category,
                    form: [
                      ...category.form,
                      {
                        id: `field${category.form.length + 1}`,
                        label: "New question",
                        placeholder: "",
                        style: "short",
                        required: true,
                        minLength: 0,
                        maxLength: 500,
                      },
                    ],
                  })
                }
                className="btn-ghost h-7 px-2 text-xs"
              >
                <Plus className="h-3.5 w-3.5" /> Add question
              </button>
            </div>

            <div className="mt-2 space-y-2">
              {category.form.map((field, index) => (
                <div key={index} className="rounded-lg border border-ink-700 bg-ink-900/60 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Question">
                      <TextInput value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} />
                    </Field>
                    <Field label="Placeholder">
                      <TextInput
                        value={field.placeholder}
                        onChange={(event) => updateField(index, { placeholder: event.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-4">
                      <Select
                        className="w-36"
                        value={field.style}
                        onChange={(style) => updateField(index, { style: style as "short" | "paragraph" })}
                        options={[
                          { value: "short", label: "Single line" },
                          { value: "paragraph", label: "Paragraph" },
                        ]}
                      />
                      <Toggle
                        checked={field.required}
                        onChange={(required) => updateField(index, { required })}
                        label="Required"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => onChange({ ...category, form: category.form.filter((_, i) => i !== index) })}
                      className="btn-ghost h-7 px-2 text-xs text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </div>
                </div>
              ))}
              {!category.form.length && (
                <p className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-center text-xs text-ink-500">
                  No form — the ticket opens immediately when someone clicks.
                </p>
              )}
            </div>
          </div>

          <Field label="First message in the ticket">
            <EmbedEditor
              value={category.openingMessage}
              onChange={(openingMessage) => onChange({ ...category, openingMessage })}
              scopes={["member", "guild", "ticket"]}
            />
          </Field>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const TicketsPage = () => {
  const { guildId, meta } = useGuildMeta();
  const config = useModuleConfig<TicketsConfig>(guildId, "tickets");
  const [tab, setTab] = useState("panels");

  if (config.isLoading || !config.data || !config.ui) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-ink-500" />
      </div>
    );
  }

  const data = config.data;
  const warning = meta?.warnings.find((w) => w.module === "tickets");
  const settingsSections = config.ui.sections.filter((s) => !["panels", "categories"].includes(s.id));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tickets</h1>
          <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-ink-400">{config.ui.description}</p>
        </div>
        <Toggle
          checked={data.enabled}
          onChange={(enabled) => config.update("enabled", enabled)}
          label={data.enabled ? "Enabled" : "Disabled"}
        />
      </header>

      {warning && <Alert tone="warning">{warning.message}</Alert>}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "panels", label: "Panels", badge: <Badge>{data.panels.length}</Badge> },
          { id: "categories", label: "Categories", badge: <Badge>{data.categories.length}</Badge> },
          { id: "settings", label: "Settings" },
        ]}
      />

      {tab === "panels" && (
        <Card
          title="Ticket panels"
          description="The message members click. Save your changes first, then press Publish to push it to Discord."
        >
          <div className="space-y-2">
            {data.panels.map((panel, index) => (
              <PanelEditor
                key={panel.id}
                panel={panel}
                categories={data.categories}
                guildId={guildId}
                onChange={(next) => config.update("panels", data.panels.map((p, i) => (i === index ? next : p)))}
                onDelete={() => config.update("panels", data.panels.filter((_, i) => i !== index))}
              />
            ))}

            <button
              type="button"
              onClick={() =>
                config.update("panels", [
                  ...data.panels,
                  {
                    id: `panel-${Date.now().toString(36)}`,
                    name: "New panel",
                    channelId: "",
                    style: "buttons",
                    selectPlaceholder: "Choose what you need help with",
                    categoryKeys: [],
                    message: emptyPayload(),
                  },
                ])
              }
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-700 py-3 text-sm text-ink-400 transition hover:border-brand-500/50 hover:text-brand-300"
            >
              <Plus className="h-4 w-4" /> Add a panel
            </button>
          </div>
        </Card>
      )}

      {tab === "categories" && (
        <Card
          title="Categories"
          description="Each category gets its own channel naming, staff roles and intake form."
        >
          <div className="space-y-2">
            {data.categories.map((category, index) => (
              <CategoryEditor
                key={category.key}
                category={category}
                onChange={(next) => config.update("categories", data.categories.map((c, i) => (i === index ? next : c)))}
                onDelete={() => {
                  config.update("categories", data.categories.filter((_, i) => i !== index));
                  config.update(
                    "panels",
                    data.panels.map((panel) => ({
                      ...panel,
                      categoryKeys: panel.categoryKeys.filter((k) => k !== category.key),
                    })),
                  );
                }}
              />
            ))}

            <button
              type="button"
              onClick={() => {
                const key = slug(`category ${data.categories.length + 1}`);
                config.update("categories", [
                  ...data.categories,
                  {
                    key,
                    label: "New category",
                    emoji: "🎫",
                    description: "",
                    enabled: true,
                    openMode: "channel",
                    parentCategoryId: "",
                    naming: "ticket-{number}",
                    supportRoles: [],
                    pingRoles: [],
                    requiredRoles: [],
                    blockedRoles: [],
                    defaultPriority: "NORMAL",
                    maxOpenPerUser: 1,
                    autoCloseHours: 72,
                    inactivityWarningHours: 48,
                    form: [],
                    openingMessage: emptyPayload(),
                  },
                ]);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-700 py-3 text-sm text-ink-400 transition hover:border-brand-500/50 hover:text-brand-300"
            >
              <Plus className="h-4 w-4" /> Add a category
            </button>
          </div>
        </Card>
      )}

      {tab === "settings" && (
        <div className="space-y-5">
          {settingsSections.map((section) => (
            <AutoFormSection
              key={section.id}
              section={{ ...section, fields: section.fields.filter((f) => f.path !== "enabled") }}
              data={data}
              onChange={config.update}
            />
          ))}
        </div>
      )}

      <SaveBar dirty={config.dirty} saving={config.saving} onSave={config.save} onReset={config.discard} />
    </div>
  );
};

export default TicketsPage;
