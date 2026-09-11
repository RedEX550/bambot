import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ExternalLink, Gavel, Search, Star, Ticket, Users } from "lucide-react";
import {
  getAudit,
  getCases,
  getLevels,
  getTicketStats,
  getTickets,
  transcriptUrl,
  updateCase,
  type CaseRow,
} from "../lib/api";
import { useGuildMeta } from "../lib/guild-context";
import { Badge, Card, EmptyState, Select, Spinner, StatCard, TextInput, useToast } from "../components/ui";

const relative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const Pager = ({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-ink-400">
      <span>
        Page {page} of {pages} · {total.toLocaleString()} total
      </span>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary text-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <button type="button" className="btn-secondary text-xs" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
};

const CASE_TONES: Record<string, "danger" | "warning" | "success" | "neutral"> = {
  BAN: "danger",
  KICK: "danger",
  SOFTBAN: "danger",
  QUARANTINE: "danger",
  WARN: "warning",
  MUTE: "warning",
  UNBAN: "success",
  UNMUTE: "success",
};

// ---------------------------------------------------------------------------

export const CasesPage = () => {
  const { guildId } = useGuildMeta();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");

  const cases = useQuery({
    queryKey: ["cases", guildId, page, search, type],
    queryFn: () => getCases(guildId, { page, q: search, type }),
  });

  const pardon = useMutation({
    mutationFn: (row: CaseRow) => updateCase(guildId, row.id, { pardoned: !row.pardoned }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases", guildId] });
      toast.push("success", "Case updated.");
    },
    onError: () => toast.push("error", "Could not update that case."),
  });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Moderation log</h1>
        <p className="mt-0.5 text-sm text-ink-400">Every action the bot recorded, including automod.</p>
      </header>

      <Card>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <TextInput
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search by member, moderator or reason"
              className="pl-9"
            />
          </div>
          <Select
            className="w-44"
            value={type}
            onChange={(next) => {
              setType(next);
              setPage(1);
            }}
            options={[
              { value: "all", label: "All types" },
              { value: "WARN", label: "Warnings" },
              { value: "MUTE", label: "Timeouts" },
              { value: "KICK", label: "Kicks" },
              { value: "BAN", label: "Bans" },
              { value: "NOTE", label: "Notes" },
            ]}
          />
        </div>

        <div className="mt-4">
          {cases.isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner className="text-ink-500" />
            </div>
          ) : cases.data?.items.length ? (
            <>
              <div className="space-y-2">
                {cases.data.items.map((row) => (
                  <div
                    key={row.id}
                    className={`rounded-lg border border-ink-700 bg-ink-850/50 px-4 py-3 ${row.pardoned ? "opacity-60" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink-500">#{row.caseNumber}</span>
                      <Badge tone={CASE_TONES[row.type] ?? "neutral"}>{row.type}</Badge>
                      <span className="text-sm font-medium text-ink-100">{row.targetTag}</span>
                      {row.pardoned && <Badge tone="neutral">pardoned</Badge>}
                      <span className="ml-auto text-xs text-ink-500">{relative(row.createdAt)}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-ink-300">{row.reason}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs text-ink-500">by {row.moderatorTag}</span>
                      <button
                        type="button"
                        onClick={() => pardon.mutate(row)}
                        className="btn-ghost h-6 px-2 text-[11px]"
                        disabled={pardon.isPending}
                      >
                        {row.pardoned ? "Un-pardon" : "Pardon"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <Pager page={page} total={cases.data.total} pageSize={cases.data.pageSize} onChange={setPage} />
            </>
          ) : (
            <EmptyState icon={<Gavel className="h-7 w-7" />} title="No cases found" description="Nothing matches those filters." />
          )}
        </div>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------

export const TicketQueuePage = () => {
  const { guildId } = useGuildMeta();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("open");

  const tickets = useQuery({
    queryKey: ["tickets", guildId, page, status],
    queryFn: () => getTickets(guildId, { page, status }),
  });
  const stats = useQuery({ queryKey: ["ticket-stats", guildId], queryFn: () => getTicketStats(guildId) });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Ticket queue</h1>
        <p className="mt-0.5 text-sm text-ink-400">Live support load and per-staff performance.</p>
      </header>

      {stats.data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Open now" value={stats.data.open} tone={stats.data.open > 20 ? "warning" : "brand"} icon={<Ticket className="h-4 w-4" />} />
          <StatCard label="Last 30 days" value={stats.data.total} sub="tickets opened" />
          <StatCard
            label="Busiest category"
            value={stats.data.byCategory[0]?.key ?? "—"}
            sub={stats.data.byCategory[0] ? `${stats.data.byCategory[0].count} tickets` : undefined}
          />
        </div>
      )}

      {stats.data && stats.data.staff.length > 0 && (
        <Card title="Staff performance" description="Based on who claimed each ticket in the last 30 days.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="pb-2 font-medium">Staff</th>
                  <th className="pb-2 text-right font-medium">Handled</th>
                  <th className="pb-2 text-right font-medium">Avg response</th>
                  <th className="pb-2 text-right font-medium">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {stats.data.staff.slice(0, 15).map((member) => (
                  <tr key={member.id}>
                    <td className="py-2 text-ink-200">{member.tag}</td>
                    <td className="py-2 text-right tabular-nums text-ink-300">{member.handled}</td>
                    <td className="py-2 text-right tabular-nums text-ink-300">
                      {member.averageResponseMinutes === null ? "—" : `${member.averageResponseMinutes}m`}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-300">
                      {member.averageRating === null ? (
                        "—"
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-3 w-3 text-amber-400" />
                          {member.averageRating.toFixed(1)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title="Tickets"
        actions={
          <Select
            className="w-36"
            value={status}
            onChange={(next) => {
              setStatus(next);
              setPage(1);
            }}
            options={[
              { value: "open", label: "Open" },
              { value: "CLOSED", label: "Closed" },
              { value: "all", label: "All" },
            ]}
          />
        }
      >
        {tickets.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="text-ink-500" />
          </div>
        ) : tickets.data?.items.length ? (
          <>
            <div className="space-y-2">
              {tickets.data.items.map((ticket) => (
                <div key={ticket.id} className="rounded-lg border border-ink-700 bg-ink-850/50 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-500">#{ticket.ticketNumber}</span>
                    <Badge tone={ticket.status === "CLOSED" ? "neutral" : ticket.status === "CLAIMED" ? "info" : "brand"}>
                      {ticket.status}
                    </Badge>
                    <Badge tone={ticket.priority === "URGENT" ? "danger" : ticket.priority === "HIGH" ? "warning" : "neutral"}>
                      {ticket.priority}
                    </Badge>
                    <span className="text-sm text-ink-200">{ticket.openerTag}</span>
                    <span className="text-xs text-ink-500">{ticket.categoryKey}</span>
                    <span className="ml-auto text-xs text-ink-500">{relative(ticket.createdAt)}</span>
                  </div>

                  {ticket.subject && <p className="mt-1.5 truncate text-sm text-ink-300">{ticket.subject}</p>}

                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                    <span>{ticket.claimedByTag ? `claimed by ${ticket.claimedByTag}` : "unclaimed"}</span>
                    {ticket.firstResponseMinutes !== null && <span>first reply in {ticket.firstResponseMinutes}m</span>}
                    {ticket.rating && (
                      <span className="inline-flex items-center gap-1 text-amber-400">
                        <Star className="h-3 w-3" />
                        {ticket.rating}/5
                      </span>
                    )}
                    {ticket.transcriptId && (
                      <a
                        href={transcriptUrl(guildId, ticket.transcriptId)}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-brand-400 hover:underline"
                      >
                        Transcript <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Pager page={page} total={tickets.data.total} pageSize={tickets.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState icon={<Ticket className="h-7 w-7" />} title="No tickets" description="Nothing matches that filter." />
        )}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------

export const MembersPage = () => {
  const { guildId } = useGuildMeta();
  const [page, setPage] = useState(1);
  const levels = useQuery({ queryKey: ["levels", guildId, page], queryFn: () => getLevels(guildId, page) });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Levels</h1>
        <p className="mt-0.5 text-sm text-ink-400">The XP leaderboard as the bot sees it.</p>
      </header>

      <Card>
        {levels.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="text-ink-500" />
          </div>
        ) : levels.data?.items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="pb-2 font-medium">#</th>
                    <th className="pb-2 font-medium">Member</th>
                    <th className="pb-2 text-right font-medium">Level</th>
                    <th className="pb-2 text-right font-medium">XP</th>
                    <th className="pb-2 text-right font-medium">Messages</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800">
                  {levels.data.items.map((row, index) => (
                    <tr key={row.id}>
                      <td className="py-2 tabular-nums text-ink-500">
                        {(page - 1) * levels.data.pageSize + index + 1}
                      </td>
                      <td className="py-2 font-mono text-xs text-ink-300">{row.userId}</td>
                      <td className="py-2 text-right tabular-nums text-brand-300">{row.level}</td>
                      <td className="py-2 text-right tabular-nums text-ink-300">{row.xp.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums text-ink-400">{row.messages.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={levels.data.total} pageSize={levels.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="Nobody has earned XP yet"
            description="Turn on the Levels module and members start earning as they chat."
          />
        )}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------

export const AuditPage = () => {
  const { guildId } = useGuildMeta();
  const [page, setPage] = useState(1);
  const audit = useQuery({ queryKey: ["audit", guildId, page], queryFn: () => getAudit(guildId, page) });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-0.5 text-sm text-ink-400">Every change made from this dashboard.</p>
      </header>

      <Card>
        {audit.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="text-ink-500" />
          </div>
        ) : audit.data?.items.length ? (
          <>
            <div className="space-y-1">
              {audit.data.items.map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-ink-850/60">
                  <Activity className="h-3.5 w-3.5 shrink-0 text-ink-600" />
                  <span className="text-sm text-ink-200">{entry.userTag}</span>
                  <code className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-300">{entry.action}</code>
                  {entry.module && <Badge>{entry.module}</Badge>}
                  <span className="min-w-0 truncate text-xs text-ink-400">{entry.summary}</span>
                  <span className="ml-auto shrink-0 text-xs text-ink-500">{relative(entry.createdAt)}</span>
                </div>
              ))}
            </div>
            <Pager page={page} total={audit.data.total} pageSize={audit.data.pageSize} onChange={setPage} />
          </>
        ) : (
          <EmptyState icon={<Activity className="h-7 w-7" />} title="Nothing logged yet" description="Changes you make here will show up in this list." />
        )}
      </Card>
    </div>
  );
};
