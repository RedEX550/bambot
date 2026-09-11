import { createContext, useContext, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { GuildMeta } from "@bambot/shared";
import { getGuildMeta } from "./api";

interface GuildContextValue {
  guildId: string;
  meta: GuildMeta | undefined;
  metaQuery: UseQueryResult<GuildMeta>;
}

const GuildContext = createContext<GuildContextValue | null>(null);

/**
 * Holds the live channel and role lists for the selected guild.
 *
 * Every picker in the dashboard reads from here rather than fetching its own
 * copy, so opening a settings page costs one request no matter how many
 * channel dropdowns it contains.
 */
export const GuildProvider = ({ guildId, children }: { guildId: string; children: ReactNode }) => {
  const metaQuery = useQuery({
    queryKey: ["guild-meta", guildId],
    queryFn: () => getGuildMeta(guildId),
    staleTime: 60_000,
    retry: 1,
  });

  return (
    <GuildContext.Provider value={{ guildId, meta: metaQuery.data, metaQuery }}>{children}</GuildContext.Provider>
  );
};

export const useGuildMeta = (): GuildContextValue => {
  const context = useContext(GuildContext);
  if (!context) {
    // Pickers are only ever rendered inside a guild route; this keeps the
    // failure loud instead of silently rendering empty dropdowns.
    throw new Error("useGuildMeta must be used inside a GuildProvider");
  }
  return context;
};

export const useGuildId = (): string => useGuildMeta().guildId;
