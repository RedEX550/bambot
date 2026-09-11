import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp, Copy, Eye, Image, Plus, Trash2, Type, Variable } from "lucide-react";
import type { EmbedTemplate, MessagePayload, PlaceholderScope } from "@bambot/shared";
import { placeholdersForScopes } from "@bambot/shared";
import { Field, TextArea, TextInput, Toggle, Select, Badge } from "./ui";
import { ColorInput } from "./pickers";

// ---------------------------------------------------------------------------
// Discord-flavoured markdown, for the preview only
// ---------------------------------------------------------------------------

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Renders the small subset of markdown Discord supports in embeds.
 * Output is escaped first, so a template can never inject markup into the
 * dashboard itself.
 */
const renderMarkdown = (raw: string): string => {
  let html = escapeHtml(raw);
  html = html.replace(/```([\s\S]*?)```/g, '<pre class="my-1 rounded bg-black/40 p-2 text-xs">$1</pre>');
  html = html.replace(/`([^`\n]+)`/g, '<code class="rounded bg-black/40 px-1 py-0.5 text-[0.85em]">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/__([^_]+)__/g, "<u>$1</u>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  html = html.replace(/^&gt; (.+)$/gm, '<span class="block border-l-4 border-white/20 pl-2">$1</span>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="text-[#00a8fc]">$1</span>');
  html = html.replace(/\{(user|ticket\.opener|ticket\.claimer|case\.moderator)\}/g, '<span class="rounded bg-[#3c4270] px-1 text-[#c9cdfb]">@member</span>');
  html = html.replace(/\{(ticket\.channel)\}/g, '<span class="rounded bg-[#3c4270] px-1 text-[#c9cdfb]">#channel</span>');
  html = html.replace(/\{([a-zA-Z0-9_.]+)\}/g, '<span class="rounded bg-brand-500/20 px-1 text-brand-300">$1</span>');
  return html.replace(/\n/g, "<br>");
};

const Markdown = ({ text, className }: { text: string; className?: string }) => (
  <span className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
);

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

const EmbedPreview = ({ embed }: { embed: EmbedTemplate }) => {
  const color = /^#[0-9a-fA-F]{6}$/.test(embed.color ?? "") ? embed.color! : "#00AE42";
  const hasAnything =
    embed.title || embed.description || embed.fields?.length || embed.image || embed.thumbnail || embed.author?.name || embed.footer?.text;

  if (!hasAnything) {
    return (
      <div className="discord-embed border-l-ink-600 text-xs italic text-ink-500">
        This embed is empty and will not be sent.
      </div>
    );
  }

  return (
    <div className="discord-embed" style={{ borderLeftColor: color }}>
      {embed.author?.name && (
        <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-white">
          {embed.author.iconUrl && (
            <span className="h-6 w-6 shrink-0 rounded-full bg-white/10 bg-cover bg-center" style={{ backgroundImage: `url(${embed.author.iconUrl})` }} />
          )}
          <Markdown text={embed.author.name} />
        </div>
      )}

      {embed.title && (
        <div className={clsx("mb-1 font-semibold", embed.url ? "text-[#00a8fc]" : "text-white")}>
          <Markdown text={embed.title} />
        </div>
      )}

      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          {embed.description && (
            <div className="whitespace-pre-wrap break-words text-sm leading-[1.375]">
              <Markdown text={embed.description} />
            </div>
          )}

          {embed.fields && embed.fields.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {embed.fields.map((field, index) => (
                <div key={index} className={field.inline ? "col-span-1" : "col-span-3"}>
                  <div className="text-xs font-semibold text-white">
                    <Markdown text={field.name} />
                  </div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-[1.375]">
                    <Markdown text={field.value} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {embed.thumbnail && (
          <div
            className="h-20 w-20 shrink-0 rounded bg-white/5 bg-cover bg-center"
            style={{ backgroundImage: `url(${embed.thumbnail})` }}
          />
        )}
      </div>

      {embed.image && (
        <div
          className="mt-3 h-44 w-full rounded bg-white/5 bg-cover bg-center"
          style={{ backgroundImage: `url(${embed.image})` }}
        />
      )}

      {(embed.footer?.text || embed.timestamp) && (
        <div className="mt-2 flex items-center gap-2 text-xs text-[#949ba4]">
          {embed.footer?.iconUrl && (
            <span className="h-5 w-5 shrink-0 rounded-full bg-white/10 bg-cover bg-center" style={{ backgroundImage: `url(${embed.footer.iconUrl})` }} />
          )}
          {embed.footer?.text && <Markdown text={embed.footer.text} />}
          {embed.footer?.text && embed.timestamp && <span>•</span>}
          {embed.timestamp && <span>Today at 12:00</span>}
        </div>
      )}
    </div>
  );
};

export const MessagePreview = ({ payload, botName = "Bambot" }: { payload: MessagePayload; botName?: string }) => (
  <div className="rounded-lg bg-[#313338] p-4 font-sans">
    <div className="flex gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
        B
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{botName}</span>
          <span className="rounded bg-[#5865f2] px-1 py-px text-[10px] font-semibold uppercase text-white">App</span>
          <span className="text-xs text-[#949ba4]">Today at 12:00</span>
        </div>

        {payload.content && (
          <div className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-[1.375] text-[#dbdee1]">
            <Markdown text={payload.content} />
          </div>
        )}

        <div className="mt-1 space-y-2">
          {payload.embeds?.map((embed, index) => (
            <EmbedPreview key={index} embed={embed} />
          ))}
        </div>

        {payload.buttons && payload.buttons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {payload.buttons.map((button, index) => (
              <span
                key={index}
                className={clsx(
                  "rounded px-3 py-1.5 text-sm font-medium text-white",
                  button.style === "primary" && "bg-[#5865f2]",
                  button.style === "success" && "bg-[#248046]",
                  button.style === "danger" && "bg-[#da373c]",
                  (button.style === "secondary" || button.style === "link") && "bg-[#4e5058]",
                )}
              >
                {button.emoji ? `${button.emoji} ` : ""}
                {button.label || "Button"}
              </span>
            ))}
          </div>
        )}

        {!payload.content && !payload.embeds?.length && (
          <p className="mt-1 text-sm italic text-[#949ba4]">Nothing to send yet — add some content or an embed.</p>
        )}
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Placeholder helper
// ---------------------------------------------------------------------------

const PlaceholderMenu = ({ scopes, onInsert }: { scopes: PlaceholderScope[]; onInsert: (token: string) => void }) => {
  const [open, setOpen] = useState(false);
  const placeholders = useMemo(() => placeholdersForScopes(scopes.length ? scopes : ["member", "guild"]), [scopes]);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn-ghost h-7 px-2 text-xs">
        <Variable className="h-3.5 w-3.5" /> Variables
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 max-h-72 w-80 overflow-y-auto rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-panel">
            {placeholders.map((placeholder) => (
              <button
                key={placeholder.key}
                type="button"
                onClick={() => {
                  onInsert(placeholder.key);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded px-2.5 py-1.5 text-left hover:bg-ink-800"
              >
                <code className="text-xs text-brand-300">{placeholder.key}</code>
                <span className="text-[11px] leading-tight text-ink-400">{placeholder.description}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/** A text field with a variable inserter that respects the caret position. */
const TemplateField = ({
  label,
  hint,
  value,
  onChange,
  scopes,
  multiline,
  placeholder,
  maxLength,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  scopes: PlaceholderScope[];
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
}) => {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const insert = (token: string) => {
    const element = ref.current;
    if (!element) {
      onChange(`${value}${token}`);
      return;
    }
    const start = element.selectionStart ?? value.length;
    const end = element.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="field-label">{label}</label>
        <div className="flex items-center gap-1">
          {maxLength && (
            <span className={clsx("text-[11px] tabular-nums", value.length > maxLength ? "text-red-400" : "text-ink-500")}>
              {value.length}/{maxLength}
            </span>
          )}
          <PlaceholderMenu scopes={scopes} onInsert={insert} />
        </div>
      </div>
      <div className="mt-1.5">
        {multiline ? (
          <TextArea
            ref={ref as React.RefObject<HTMLTextAreaElement>}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            rows={5}
          />
        ) : (
          <TextInput
            ref={ref as React.RefObject<HTMLInputElement>}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const emptyEmbed = (): EmbedTemplate => ({
  title: "",
  description: "",
  color: "#00AE42",
  timestamp: false,
  fields: [],
});

export const EmbedEditor = ({
  value,
  onChange,
  scopes = ["member", "guild"],
  allowButtons = true,
}: {
  value: MessagePayload;
  onChange: (value: MessagePayload) => void;
  scopes?: PlaceholderScope[];
  allowButtons?: boolean;
}) => {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [expanded, setExpanded] = useState<number | null>(0);

  const patch = (partial: Partial<MessagePayload>) => onChange({ ...value, ...partial });

  const patchEmbed = (index: number, partial: Partial<EmbedTemplate>) =>
    patch({ embeds: value.embeds.map((embed, i) => (i === index ? { ...embed, ...partial } : embed)) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-lg border border-ink-700 bg-ink-850 p-0.5">
          {(["edit", "preview"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={clsx(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition",
                tab === id ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200",
              )}
            >
              {id === "edit" ? <Type className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {id}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">
            {value.embeds.length} embed{value.embeds.length === 1 ? "" : "s"}
          </Badge>
          <button
            type="button"
            className="btn-ghost h-7 px-2 text-xs"
            onClick={() => navigator.clipboard.writeText(JSON.stringify(value, null, 2))}
            title="Copy this message as JSON"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {tab === "preview" ? (
        <MessagePreview payload={value} />
      ) : (
        <div className="space-y-4">
          <TemplateField
            label="Message text"
            hint="Sent above the embed. Use it for pings — an embed cannot mention anyone."
            value={value.content}
            onChange={(content) => patch({ content })}
            scopes={scopes}
            multiline
            maxLength={2000}
            placeholder="Optional plain text, e.g. {user}"
          />

          {value.embeds.map((embed, index) => (
            <div key={index} className="rounded-lg border border-ink-700 bg-ink-850/60">
              <button
                type="button"
                onClick={() => setExpanded(expanded === index ? null : index)}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-4 w-1 rounded-full" style={{ backgroundColor: embed.color || "#00AE42" }} />
                  <span className="truncate text-sm font-medium text-ink-100">
                    {embed.title || `Embed ${index + 1}`}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      patch({ embeds: value.embeds.filter((_, i) => i !== index) });
                    }}
                    onKeyDown={() => undefined}
                    className="rounded p-1 text-ink-500 hover:bg-ink-700 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                  {expanded === index ? <ChevronUp className="h-4 w-4 text-ink-400" /> : <ChevronDown className="h-4 w-4 text-ink-400" />}
                </span>
              </button>

              {expanded === index && (
                <div className="space-y-4 border-t border-ink-700/60 px-4 py-4">
                  <TemplateField
                    label="Title"
                    value={embed.title ?? ""}
                    onChange={(title) => patchEmbed(index, { title })}
                    scopes={scopes}
                    maxLength={256}
                  />
                  <TemplateField
                    label="Description"
                    value={embed.description ?? ""}
                    onChange={(description) => patchEmbed(index, { description })}
                    scopes={scopes}
                    multiline
                    maxLength={4096}
                  />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Accent colour">
                      <ColorInput value={embed.color ?? "#00AE42"} onChange={(color) => patchEmbed(index, { color })} />
                    </Field>
                    <Field label="Title link" hint="Makes the title clickable.">
                      <TextInput
                        value={embed.url ?? ""}
                        onChange={(event) => patchEmbed(index, { url: event.target.value })}
                        placeholder="https://wiki.bambulab.com"
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Thumbnail URL">
                      <TextInput
                        value={embed.thumbnail ?? ""}
                        onChange={(event) => patchEmbed(index, { thumbnail: event.target.value })}
                        placeholder="https://…"
                      />
                    </Field>
                    <Field label="Large image URL">
                      <TextInput
                        value={embed.image ?? ""}
                        onChange={(event) => patchEmbed(index, { image: event.target.value })}
                        placeholder="https://…"
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Author name">
                      <TextInput
                        value={embed.author?.name ?? ""}
                        onChange={(event) =>
                          patchEmbed(index, { author: { ...(embed.author ?? {}), name: event.target.value } })
                        }
                      />
                    </Field>
                    <Field label="Footer text">
                      <TextInput
                        value={embed.footer?.text ?? ""}
                        onChange={(event) =>
                          patchEmbed(index, { footer: { ...(embed.footer ?? {}), text: event.target.value } })
                        }
                      />
                    </Field>
                  </div>

                  <Toggle
                    checked={embed.timestamp}
                    onChange={(timestamp) => patchEmbed(index, { timestamp })}
                    label="Show a timestamp"
                    description="Displays the send time in the footer."
                  />

                  <div>
                    <div className="flex items-center justify-between">
                      <label className="field-label">Fields</label>
                      <button
                        type="button"
                        className="btn-ghost h-7 px-2 text-xs"
                        onClick={() =>
                          patchEmbed(index, {
                            fields: [...(embed.fields ?? []), { name: "Field name", value: "Field value", inline: false }],
                          })
                        }
                      >
                        <Plus className="h-3.5 w-3.5" /> Add field
                      </button>
                    </div>

                    <div className="mt-2 space-y-2">
                      {(embed.fields ?? []).map((field, fieldIndex) => (
                        <div key={fieldIndex} className="rounded-lg border border-ink-700 bg-ink-900/60 p-3">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <TextInput
                              value={field.name}
                              placeholder="Name"
                              onChange={(event) =>
                                patchEmbed(index, {
                                  fields: embed.fields.map((f, i) => (i === fieldIndex ? { ...f, name: event.target.value } : f)),
                                })
                              }
                            />
                            <TextInput
                              value={field.value}
                              placeholder="Value"
                              onChange={(event) =>
                                patchEmbed(index, {
                                  fields: embed.fields.map((f, i) => (i === fieldIndex ? { ...f, value: event.target.value } : f)),
                                })
                              }
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <Toggle
                              checked={field.inline}
                              onChange={(inline) =>
                                patchEmbed(index, {
                                  fields: embed.fields.map((f, i) => (i === fieldIndex ? { ...f, inline } : f)),
                                })
                              }
                              label="Inline"
                            />
                            <button
                              type="button"
                              className="btn-ghost h-7 px-2 text-xs text-red-300"
                              onClick={() =>
                                patchEmbed(index, { fields: embed.fields.filter((_, i) => i !== fieldIndex) })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Remove
                            </button>
                          </div>
                        </div>
                      ))}
                      {!(embed.fields ?? []).length && (
                        <p className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-center text-xs text-ink-500">
                          No fields. Fields are good for structured details like temperatures or order numbers.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {value.embeds.length < 10 && (
            <button
              type="button"
              onClick={() => {
                patch({ embeds: [...value.embeds, emptyEmbed()] });
                setExpanded(value.embeds.length);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-700 py-3 text-sm text-ink-400 transition hover:border-brand-500/50 hover:text-brand-300"
            >
              <Plus className="h-4 w-4" /> Add an embed
            </button>
          )}

          {allowButtons && (
            <div>
              <div className="flex items-center justify-between">
                <label className="field-label">Link buttons</label>
                <button
                  type="button"
                  className="btn-ghost h-7 px-2 text-xs"
                  disabled={value.buttons.length >= 5}
                  onClick={() =>
                    patch({ buttons: [...value.buttons, { label: "Open", style: "link", url: "https://bambulab.com" }] })
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add button
                </button>
              </div>

              <div className="mt-2 space-y-2">
                {value.buttons.map((button, index) => (
                  <div key={index} className="grid gap-2 rounded-lg border border-ink-700 bg-ink-900/60 p-3 sm:grid-cols-[1fr_1fr_auto]">
                    <TextInput
                      value={button.label}
                      placeholder="Label"
                      onChange={(event) =>
                        patch({ buttons: value.buttons.map((b, i) => (i === index ? { ...b, label: event.target.value } : b)) })
                      }
                    />
                    <TextInput
                      value={button.url ?? ""}
                      placeholder="https://…"
                      onChange={(event) =>
                        patch({ buttons: value.buttons.map((b, i) => (i === index ? { ...b, url: event.target.value } : b)) })
                      }
                    />
                    <button
                      type="button"
                      className="btn-ghost px-2 text-red-300"
                      onClick={() => patch({ buttons: value.buttons.filter((_, i) => i !== index) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {!value.buttons.length && (
                  <p className="text-xs text-ink-500">
                    Link buttons are useful for the wiki, MakerWorld or a store page.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Auto-delete after" hint="0 keeps the message forever.">
              <div className="flex items-center gap-2">
                <TextInput
                  type="number"
                  min={0}
                  max={86400}
                  value={value.deleteAfter}
                  onChange={(event) => patch({ deleteAfter: Math.max(0, Number(event.target.value) || 0) })}
                />
                <span className="text-sm text-ink-400">seconds</span>
              </div>
            </Field>
          </div>
        </div>
      )}

      {tab === "edit" && (
        <details className="rounded-lg border border-ink-700 bg-ink-850/50">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-ink-300">
            <Image className="mr-1.5 inline h-3.5 w-3.5" />
            Quick preview
          </summary>
          <div className="border-t border-ink-700/60 p-4">
            <MessagePreview payload={value} />
          </div>
        </details>
      )}
    </div>
  );
};

export default EmbedEditor;
