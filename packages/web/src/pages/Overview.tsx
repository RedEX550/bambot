import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Gavel, MessageSquare, Shield, Star, Ticket, Timer, UserPlus } from "lucide-react";
import { getOverview } from "../lib/api";
import { useGuildMeta } from "../lib/guild-context";
import { Alert, Card, EmptyState, Spinner, StatCard } from "../components/ui";

const AXIS = { stroke: "#475569", fontSize: 11 };

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850/95 px-3 py-2 text-xs shadow-panel backdrop-blur">
      <p className="mb-1 font-medium text-ink-200">{label ? shortDate(label) : ""}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 text-ink-300">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          {entry.name}: <span className="font-medium tabular-nums text-ink-100">{entry.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
};

export const OverviewPage = () => {
  const { guildId, meta } = useGuildMeta();
  const [days, setDays] = useState(30);

  const overview = useQuery({
    queryKey: ["overview", guildId, days],
    queryFn: () => getOverview(guildId, days),
  });

  const data = overview.data;
  const warnings = meta?.warnings ?? [];
  const hasActivity = data?.series.some((row) => row.messages + row.joins + row.tickets > 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-0.5 text-sm text-ink-400">How the server and the support queue are doing.</p>
        </div>
        <div className="flex rounded-lg border border-ink-700 bg-ink-850 p-0.5">
          {[7, 30, 90].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                days === option ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200"
              }`}
            >
              {option}d
            </button>
          ))}
        </div>
      </header>

      {warnings.length > 0 && (
        <Alert tone="warning" title={`${warnings.length} setting${warnings.length === 1 ? "" : "s"} need attention`}>
          <ul className="mt-1.5 space-y-1">
            {warnings.slice(0, 6).map((warning, index) => (
              <li key={index} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  <Link to={`/guilds/${guildId}/${warning.module}`} className="underline decoration-dotted underline-offset-2">
                    {warning.module}
                  </Link>
                  {" — "}
                  {warning.message}
                </span>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {overview.isLoading && (
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-ink-500" />
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Members"
              value={(meta?.memberCount ?? data.memberCount).toLocaleString()}
              sub={`+${data.joins7d} / −${data.leaves7d} this week`}
              icon={<UserPlus className="h-4 w-4" />}
            />
            <StatCard
              label="Open tickets"
              value={data.openTickets}
              sub={`${data.ticketsClosed7d} closed this week`}
              tone={data.openTickets > 20 ? "warning" : "brand"}
              icon={<Ticket className="h-4 w-4" />}
            />
            <StatCard
              label="First response"
              value={data.medianFirstResponseMinutes === null ? "—" : `${data.medianFirstResponseMinutes}m`}
              sub="median, last 30 days"
              tone={
                data.medianFirstResponseMinutes !== null && data.medianFirstResponseMinutes > 60 ? "warning" : "neutral"
              }
              icon={<Timer className="h-4 w-4" />}
            />
            <StatCard
              label="Satisfaction"
              value={data.csat === null ? "—" : `${data.csat}%`}
              sub="from ticket ratings"
              tone={data.csat !== null && data.csat < 70 ? "warning" : "brand"}
              icon={<Star className="h-4 w-4" />}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Messages" value={data.messages7d.toLocaleString()} sub="last 7 days" icon={<MessageSquare className="h-4 w-4" />} />
            <StatCard label="Mod actions" value={data.modActions7d} sub="last 7 days" icon={<Gavel className="h-4 w-4" />} />
            <StatCard label="Automod hits" value={data.automodHits7d} sub="last 7 days" icon={<Shield className="h-4 w-4" />} />
          </div>

          {!hasActivity ? (
            <Card title="Activity">
              <EmptyState
                title="No data yet"
                description="Bambot records statistics from the moment it joins. Charts fill in over the next day or two."
              />
            </Card>
          ) : (
            <>
              <Card title="Member growth" description="Joins and leaves per day.">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.series} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="joins" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00AE42" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#00AE42" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="leaves" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ef4444" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="joins" name="Joins" stroke="#00AE42" fill="url(#joins)" strokeWidth={2} />
                      <Area type="monotone" dataKey="leaves" name="Leaves" stroke="#ef4444" fill="url(#leaves)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <div className="grid gap-5 lg:grid-cols-2">
                <Card title="Messages" description="Daily message volume.">
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.series} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} tickLine={false} axisLine={false} minTickGap={28} />
                        <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} />
                        <Tooltip content={<ChartTooltip />} />
                        <Line type="monotone" dataKey="messages" name="Messages" stroke="#38bdf8" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card title="Support load" description="Tickets opened against moderation actions.">
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.series} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} tickLine={false} axisLine={false} minTickGap={28} />
                        <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="tickets" name="Tickets" fill="#00AE42" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="modActions" name="Mod actions" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>
            </>
          )}

          {data.topCommands.length > 0 && (
            <Card title="Most used commands" description="Last 7 days.">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.topCommands} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                    <XAxis type="number" {...AXIS} tickLine={false} axisLine={false} />
                    <YAxis
                      type="category"
                      dataKey="command"
                      {...AXIS}
                      tickLine={false}
                      axisLine={false}
                      width={92}
                      tickFormatter={(value: string) => `/${value}`}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "#1e293b55" }} />
                    <Bar dataKey="count" name="Uses" radius={[0, 4, 4, 0]}>
                      {data.topCommands.map((_, index) => (
                        <Cell key={index} fill={index === 0 ? "#00AE42" : "#00722d"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default OverviewPage;
