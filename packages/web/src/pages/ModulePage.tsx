import { useParams } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { useGuildMeta } from "../lib/guild-context";
import { useModuleConfig } from "../lib/use-module-config";
import { AutoForm } from "../components/AutoForm";
import { CUSTOM_FIELDS } from "../components/custom-fields";
import { Alert, Card, EmptyState, SaveBar, Spinner } from "../components/ui";
import { WelcomePage } from "./WelcomePage";
import { TicketsPage } from "./TicketsPage";
import { RoleMenusPage } from "./RoleMenusPage";

/** Modules whose page is hand-built instead of generated from field specs. */
const CUSTOM_PAGES: Record<string, () => JSX.Element> = {
  WelcomePage,
  TicketsPage,
  RoleMenusPage,
};

/**
 * Renders any module's settings.
 *
 * Most modules are entirely generated from the field specs in @bambot/shared,
 * which is what keeps "every feature is editable" true without hand-writing
 * twenty pages. A module can opt into a bespoke page via `ui.customPage`.
 */
export const ModulePage = () => {
  const { module = "" } = useParams();
  const { guildId } = useGuildMeta();
  const config = useModuleConfig<Record<string, unknown>>(guildId, module);

  const CustomPage = config.ui?.customPage ? CUSTOM_PAGES[config.ui.customPage] : undefined;
  if (CustomPage) return <CustomPage />;

  if (config.isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-ink-500" />
      </div>
    );
  }

  if (config.isError || !config.ui || !config.data) {
    return (
      <Card>
        <EmptyState
          title="Could not load this module"
          description={config.error instanceof Error ? config.error.message : "Try refreshing the page."}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{config.ui.title}</h1>
          <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-ink-400">{config.ui.description}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Reset ${config.ui!.title} back to the defaults? This cannot be undone.`)) {
              config.resetToDefaults();
            }
          }}
          className="btn-ghost text-xs"
          disabled={config.resetting}
        >
          {config.resetting ? <Spinner /> : <RotateCcw className="h-3.5 w-3.5" />}
          Reset to defaults
        </button>
      </header>

      {config.validationErrors.length > 0 && (
        <Alert tone="danger" title="Some settings could not be saved">
          <ul className="mt-1 space-y-0.5">
            {config.validationErrors.slice(0, 6).map((issue, index) => (
              <li key={index}>
                <code className="text-[11px]">{issue.path || "value"}</code> — {issue.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <AutoForm sections={config.ui.sections} data={config.data} onChange={config.update} custom={CUSTOM_FIELDS} />

      <SaveBar
        dirty={config.dirty}
        saving={config.saving}
        onSave={config.save}
        onReset={config.discard}
      />
    </div>
  );
};

export default ModulePage;
