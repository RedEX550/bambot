import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { List, Plus, Send, Trash2 } from "lucide-react";
import type { MessagePayload } from "@bambot/shared";
import { deleteRoleMenu, getRoleMenus, publishRoleMenu, saveRoleMenu, type RoleMenuRow } from "../lib/api";
import { useGuildMeta } from "../lib/guild-context";
import { useModuleConfig } from "../lib/use-module-config";
import { AutoFormSection } from "../components/AutoForm";
import { EmbedEditor } from "../components/EmbedEditor";
import { Badge, Card, EmptyState, Field, Modal, SaveBar, Select, Spinner, TextInput, useToast } from "../components/ui";
import { ChannelSelect, RoleSelect } from "../components/pickers";

interface MenuOption {
  roleId: string;
  label: string;
  description: string;
  emoji: string;
  style: string;
}

interface MenuDraft {
  name: string;
  channelId: string;
  style: string;
  placeholder: string;
  minSelect: number;
  maxSelect: number;
  embed: MessagePayload;
  options: MenuOption[];
}

const blankDraft = (): MenuDraft => ({
  name: "",
  channelId: "",
  style: "button",
  placeholder: "Pick your roles",
  minSelect: 0,
  maxSelect: 0,
  embed: {
    content: "",
    embeds: [
      {
        title: "Choose your roles",
        description: "Pick the printers you own and the notifications you want.",
        color: "#00AE42",
        timestamp: false,
        fields: [],
      },
    ],
    buttons: [],
    ghostPing: false,
    deleteAfter: 0,
  },
  options: [],
});

export const RoleMenusPage = () => {
  const { guildId } = useGuildMeta();
  const toast = useToast();
  const queryClient = useQueryClient();
  const config = useModuleConfig<Record<string, unknown>>(guildId, "rolemenus");

  const menus = useQuery({ queryKey: ["rolemenus", guildId], queryFn: () => getRoleMenus(guildId) });
  const [draft, setDraft] = useState<MenuDraft | null>(null);

  const save = useMutation({
    mutationFn: (body: MenuDraft) => saveRoleMenu(guildId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rolemenus", guildId] });
      setDraft(null);
      toast.push("success", "Menu saved. Publish it to post or refresh the message.");
    },
    onError: (error: unknown) => toast.push("error", error instanceof Error ? error.message : "Could not save."),
  });

  const publish = useMutation({
    mutationFn: (id: string) => publishRoleMenu(guildId, id),
    onSuccess: (result) => {
      toast.push(result.ok ? "success" : "error", result.message);
      queryClient.invalidateQueries({ queryKey: ["rolemenus", guildId] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRoleMenu(guildId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rolemenus", guildId] });
      toast.push("success", "Menu deleted. The posted message stays until you remove it in Discord.");
    },
  });

  const editExisting = (menu: RoleMenuRow) =>
    setDraft({
      name: menu.name,
      channelId: menu.channelId,
      style: menu.style,
      placeholder: menu.placeholder ?? "",
      minSelect: menu.minSelect,
      maxSelect: menu.maxSelect,
      embed: (menu.embed as MessagePayload) ?? blankDraft().embed,
      options: menu.options ?? [],
    });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Role menus</h1>
          <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-ink-400">
            Self-assignable roles — printer models, regions, notification pings.
          </p>
        </div>
        <button type="button" onClick={() => setDraft(blankDraft())} className="btn-primary text-xs">
          <Plus className="h-3.5 w-3.5" /> New menu
        </button>
      </header>

      <Card title="Menus">
        {menus.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="text-ink-500" />
          </div>
        ) : menus.data?.items.length ? (
          <div className="space-y-2">
            {menus.data.items.map((menu) => (
              <div key={menu.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 bg-ink-850/50 px-4 py-3">
                <button type="button" onClick={() => editExisting(menu)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <List className="h-4 w-4 shrink-0 text-ink-500" />
                  <span className="truncate text-sm font-medium text-ink-100">{menu.name}</span>
                  <Badge>{menu.options.length} roles</Badge>
                  <Badge tone={menu.messageId ? "success" : "warning"}>{menu.messageId ? "published" : "not posted"}</Badge>
                </button>
                <button
                  type="button"
                  onClick={() => publish.mutate(menu.id)}
                  disabled={!menu.channelId || publish.isPending}
                  className="btn-secondary text-xs"
                >
                  {publish.isPending ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
                  Publish
                </button>
                <button
                  type="button"
                  onClick={() => window.confirm(`Delete "${menu.name}"?`) && remove.mutate(menu.id)}
                  className="btn-ghost h-8 w-8 p-0 text-ink-500 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<List className="h-7 w-7" />}
            title="No role menus yet"
            description="A printer-model menu is the classic one: members pick the machine they own and the right channels unlock."
            action={
              <button type="button" onClick={() => setDraft(blankDraft())} className="btn-primary text-xs">
                <Plus className="h-3.5 w-3.5" /> Create one
              </button>
            }
          />
        )}
      </Card>

      {config.ui?.sections
        .filter((section) => section.id !== "menus")
        .map((section) => (
          <AutoFormSection key={section.id} section={section} data={config.data} onChange={config.update} />
        ))}

      <SaveBar dirty={config.dirty} saving={config.saving} onSave={config.save} onReset={config.discard} />

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.name ? `Edit "${draft.name}"` : "New role menu"}
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!draft?.name || !draft?.options.length || save.isPending}
              onClick={() => draft && save.mutate(draft)}
            >
              {save.isPending && <Spinner />}
              Save menu
            </button>
          </>
        }
      >
        {draft && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Menu name" hint="Used to identify it here. Must be unique.">
                <TextInput value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </Field>
              <Field label="Channel">
                <ChannelSelect value={draft.channelId} onChange={(channelId) => setDraft({ ...draft, channelId })} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Style">
                <Select
                  value={draft.style}
                  onChange={(style) => setDraft({ ...draft, style })}
                  options={[
                    { value: "button", label: "Buttons" },
                    { value: "select", label: "Dropdown" },
                  ]}
                />
              </Field>
              {draft.style === "select" && (
                <Field label="Max selectable" hint="0 means no limit.">
                  <TextInput
                    type="number"
                    min={0}
                    max={25}
                    value={draft.maxSelect}
                    onChange={(event) => setDraft({ ...draft, maxSelect: Number(event.target.value) })}
                  />
                </Field>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="field-label">Roles</label>
                <button
                  type="button"
                  disabled={draft.options.length >= 25}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      options: [...draft.options, { roleId: "", label: "", description: "", emoji: "", style: "secondary" }],
                    })
                  }
                  className="btn-ghost h-7 px-2 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" /> Add role
                </button>
              </div>

              <div className="mt-2 space-y-2">
                {draft.options.map((option, index) => (
                  <div key={index} className="rounded-lg border border-ink-700 bg-ink-900/60 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="Role">
                        <RoleSelect
                          value={option.roleId}
                          onChange={(roleId) =>
                            setDraft({
                              ...draft,
                              options: draft.options.map((o, i) => (i === index ? { ...o, roleId } : o)),
                            })
                          }
                        />
                      </Field>
                      <Field label="Button label">
                        <TextInput
                          value={option.label}
                          placeholder="e.g. P1S owner"
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              options: draft.options.map((o, i) => (i === index ? { ...o, label: event.target.value } : o)),
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[80px_1fr_auto]">
                      <Field label="Emoji">
                        <TextInput
                          value={option.emoji}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              options: draft.options.map((o, i) => (i === index ? { ...o, emoji: event.target.value } : o)),
                            })
                          }
                        />
                      </Field>
                      <Field label="Description">
                        <TextInput
                          value={option.description}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              options: draft.options.map((o, i) =>
                                i === index ? { ...o, description: event.target.value } : o,
                              ),
                            })
                          }
                        />
                      </Field>
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) })}
                        className="btn-ghost mt-6 h-9 w-9 p-0 text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {!draft.options.length && (
                  <p className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-center text-xs text-ink-500">
                    Add at least one role before saving.
                  </p>
                )}
              </div>
            </div>

            <Field label="Message">
              <EmbedEditor value={draft.embed} onChange={(embed) => setDraft({ ...draft, embed })} scopes={["guild"]} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default RoleMenusPage;
