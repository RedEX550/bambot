import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, Plus, RefreshCw, Search, ServerCrash } from "lucide-react";
import { getGuilds, getMe, logout } from "../lib/api";
import { EmptyState, Spinner, TextInput } from "../components/ui";

export const GuildPickerPage = () => {
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: Infinity });
  const guilds = useQuery({ queryKey: ["guilds"], queryFn: () => getGuilds(false) });

  const refresh = async () => {
    setRefreshing(true);
    await guilds.refetch();
    setRefreshing(false);
  };

  const filtered = (guilds.data?.guilds ?? []).filter((guild) =>
    guild.name.toLowerCase().includes(query.toLowerCase()),
  );
  const withBot = filtered.filter((g) => g.botPresent);
  const withoutBot = filtered.filter((g) => !g.botPresent);

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-tight">Choose a server</p>
            <p className="text-xs text-ink-400">
              Signed in as {me.data?.user.username ?? "…"}
              {me.data?.isOwner && <span className="ml-1.5 text-brand-400">• bot owner</span>}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={async () => {
            await logout().catch(() => undefined);
            window.location.href = "/login";
          }}
          className="btn-ghost text-xs"
        >
          Sign out
        </button>
      </header>

      <div className="mt-8 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your servers"
            className="pl-9"
          />
        </div>
        <button type="button" onClick={refresh} className="btn-secondary shrink-0" disabled={refreshing}>
          {refreshing ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {guilds.isLoading && (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-ink-500" />
        </div>
      )}

      {guilds.isError && (
        <div className="panel mt-6">
          <EmptyState
            icon={<ServerCrash className="h-8 w-8" />}
            title="Could not load your servers"
            description="Discord may be rate limiting the request. Wait a few seconds and press refresh."
          />
        </div>
      )}

      {guilds.data && (
        <div className="mt-6 space-y-8">
          {withBot.length > 0 && (
            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Ready to configure</p>
              <div className="space-y-2">
                {withBot.map((guild) => (
                  <Link
                    key={guild.id}
                    to={`/guilds/${guild.id}`}
                    className="panel group flex items-center gap-4 px-4 py-3.5 transition hover:border-brand-500/40 hover:bg-ink-850"
                  >
                    {guild.iconUrl ? (
                      <img src={guild.iconUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-800 font-semibold text-ink-400">
                        {guild.name[0]}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink-100">{guild.name}</p>
                      {guild.memberCount ? (
                        <p className="text-xs text-ink-500">{guild.memberCount.toLocaleString()} members</p>
                      ) : null}
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-brand-400" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {withoutBot.length > 0 && (
            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Bambot is not here yet</p>
              <div className="space-y-2">
                {withoutBot.map((guild) => (
                  <div key={guild.id} className="panel flex items-center gap-4 px-4 py-3.5 opacity-75">
                    {guild.iconUrl ? (
                      <img src={guild.iconUrl} alt="" className="h-11 w-11 rounded-xl object-cover grayscale" />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-800 font-semibold text-ink-500">
                        {guild.name[0]}
                      </div>
                    )}
                    <p className="min-w-0 flex-1 truncate font-medium text-ink-300">{guild.name}</p>
                    <a
                      href={`${guilds.data.inviteUrl}&guild_id=${guild.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary shrink-0 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" /> Invite
                    </a>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!filtered.length && (
            <div className="panel">
              <EmptyState
                title={query ? "No servers match that search" : "No servers to configure"}
                description={
                  query
                    ? undefined
                    : "You need the Manage Server permission in a server for it to appear here. If you just got it, press Refresh."
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GuildPickerPage;
