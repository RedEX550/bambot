import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Image as ImageIcon, RefreshCw, Sparkles } from "lucide-react";
import type { WelcomeConfig } from "@bambot/shared";
import { runAction } from "../lib/api";
import { useGuildMeta } from "../lib/guild-context";
import { useModuleConfig } from "../lib/use-module-config";
import { AutoFormSection } from "../components/AutoForm";
import { CUSTOM_FIELDS } from "../components/custom-fields";
import { Alert, Card, EmptyState, SaveBar, Spinner, Toggle, useToast } from "../components/ui";
import { MessagePreview } from "../components/EmbedEditor";

interface PreviewResult {
  content: string;
  embeds: unknown[];
  imageBase64: string | null;
  member: { id: string; displayName: string; avatarUrl: string };
}

/**
 * The welcome page gets a bespoke layout because the banner is rendered by the
 * bot, not the browser. The preview button asks the bot to render the real
 * thing with a real member, which catches font, avatar and URL problems that a
 * mocked-up preview would hide.
 */
export const WelcomePage = () => {
  const { guildId, meta } = useGuildMeta();
  const toast = useToast();
  const config = useModuleConfig<WelcomeConfig>(guildId, "welcome");
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const previewMutation = useMutation({
    mutationFn: () => runAction<PreviewResult>(guildId, "previewWelcome", {}),
    onSuccess: (result) => {
      if (result.ok && result.data) {
        setPreview(result.data);
      } else {
        toast.push("error", result.message);
      }
    },
    onError: (error: unknown) =>
      toast.push("error", error instanceof Error ? error.message : "Could not render a preview."),
  });

  if (config.isLoading || !config.data || !config.ui) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-ink-500" />
      </div>
    );
  }

  const data = config.data;
  const sections = config.ui.sections;
  const section = (id: string) => sections.find((s) => s.id === id);

  const warning = meta?.warnings.find((w) => w.module === "welcome");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Welcome</h1>
          <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-ink-400">{config.ui.description}</p>
        </div>
        <Toggle
          checked={data.enabled}
          onChange={(enabled) => config.update("enabled", enabled)}
          label={data.enabled ? "Enabled" : "Disabled"}
        />
      </header>

      {warning && <Alert tone="warning">{warning.message}</Alert>}

      {/* Live preview sits at the top: it is the thing people want to look at. */}
      <Card
        title="Live preview"
        description="Rendered by the bot exactly as a real join would be, using real server data."
        actions={
          <button
            type="button"
            onClick={() => previewMutation.mutate()}
            className="btn-secondary text-xs"
            disabled={previewMutation.isPending}
          >
            {previewMutation.isPending ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
            {preview ? "Refresh" : "Render preview"}
          </button>
        }
      >
        {preview ? (
          <div className="space-y-4">
            {preview.imageBase64 && (
              <img
                src={preview.imageBase64}
                alt="Welcome banner preview"
                className="w-full rounded-lg border border-ink-700"
              />
            )}
            <MessagePreview payload={{ ...data.message, buttons: data.message.buttons }} />
            <p className="text-xs text-ink-500">
              Placeholders above are resolved against <span className="text-ink-300">{preview.member.displayName}</span>.
            </p>
          </div>
        ) : (
          <EmptyState
            icon={<Sparkles className="h-7 w-7" />}
            title="Nothing rendered yet"
            description="Press render to have the bot draw the banner and resolve every placeholder for real."
          />
        )}
        {!data.image.enabled && preview && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
            <ImageIcon className="h-3.5 w-3.5" /> The banner is switched off, so only the message is shown.
          </p>
        )}
      </Card>

      {section("general") && (
        <AutoFormSection
          section={{ ...section("general")!, fields: section("general")!.fields.filter((f) => f.path !== "enabled") }}
          data={data}
          onChange={config.update}
          custom={CUSTOM_FIELDS}
        />
      )}
      {section("image") && (
        <AutoFormSection section={section("image")!} data={data} onChange={config.update} custom={CUSTOM_FIELDS} />
      )}
      {section("dm") && (
        <AutoFormSection section={section("dm")!} data={data} onChange={config.update} custom={CUSTOM_FIELDS} />
      )}
      {section("guards") && (
        <AutoFormSection section={section("guards")!} data={data} onChange={config.update} custom={CUSTOM_FIELDS} />
      )}

      <SaveBar dirty={config.dirty} saving={config.saving} onSave={config.save} onReset={config.discard} />
    </div>
  );
};

export default WelcomePage;
