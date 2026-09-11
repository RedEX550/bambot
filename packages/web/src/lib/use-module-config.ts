import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModuleUi } from "@bambot/shared";
import { ApiError, getModuleConfig, resetModuleConfig, saveModuleConfig } from "./api";
import { setPath } from "../components/AutoForm";
import { useToast } from "../components/ui";

/**
 * Drives every settings page.
 *
 * The server response is the source of truth; edits live in a local draft until
 * saved. Dirty state is a deep comparison rather than a flag, so toggling a
 * setting and toggling it back correctly reports "no changes".
 */
export const useModuleConfig = <T,>(guildId: string, module: string) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: ["config", guildId, module],
    queryFn: () => getModuleConfig<T>(guildId, module),
  });

  const [draft, setDraft] = useState<T | null>(null);
  const [validationErrors, setValidationErrors] = useState<{ path: string; message: string }[]>([]);

  useEffect(() => {
    if (query.data) setDraft(query.data.data);
  }, [query.data]);

  const dirty = useMemo(() => {
    if (!draft || !query.data) return false;
    return JSON.stringify(draft) !== JSON.stringify(query.data.data);
  }, [draft, query.data]);

  // Warns before a reload or tab close while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const update = useCallback((path: string, value: unknown) => {
    setDraft((current) => (current ? setPath(current, path, value) : current));
  }, []);

  const replace = useCallback((next: T) => setDraft(next), []);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("nothing to save");
      return saveModuleConfig<T>(guildId, module, draft);
    },
    onSuccess: (response) => {
      setValidationErrors([]);
      queryClient.setQueryData(["config", guildId, module], response);
      queryClient.invalidateQueries({ queryKey: ["guild-meta", guildId] });
      toast.push("success", "Settings saved.");
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.code === "validation_failed") {
        const details = (error.details as { path: string; message: string }[]) ?? [];
        setValidationErrors(details);
        toast.push("error", details[0] ? `${details[0].path}: ${details[0].message}` : error.message);
        return;
      }
      toast.push("error", error instanceof Error ? error.message : "Could not save.");
    },
  });

  const reset = useMutation({
    mutationFn: () => resetModuleConfig(guildId, module),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config", guildId, module] });
      toast.push("success", "Reset to defaults.");
    },
    onError: () => toast.push("error", "Could not reset."),
  });

  return {
    ui: query.data?.ui as ModuleUi | undefined,
    data: draft,
    serverData: query.data?.data,
    updatedAt: query.data?.updatedAt ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    dirty,
    validationErrors,
    update,
    replace,
    discard: () => {
      if (query.data) setDraft(query.data.data);
      setValidationErrors([]);
    },
    save: () => save.mutate(),
    saving: save.isPending,
    resetToDefaults: () => reset.mutate(),
    resetting: reset.isPending,
  };
};
