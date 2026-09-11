import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Bot,
  ChevronLeft,
  DoorOpen,
  Gavel,
  Gift,
  Hash,
  LayoutDashboard,
  Lightbulb,
  List,
  Lock,
  Mail,
  Menu,
  Mic,
  Printer,
  Scroll,
  Settings,
  Shield,
  Siren,
  Star,
  Ticket,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { getBotHealth, getMe, getSchema, logout } from "../lib/api";
import { GuildProvider, useGuildMeta } from "../lib/guild-context";
import { Spinner } from "./ui";

const ICONS: Record<string, typeof Settings> = {
  settings: Settings,
  wave: UserPlus,
  door: DoorOpen,
  "user-plus": UserPlus,
  lock: Lock,
  ticket: Ticket,
  mail: Mail,
  shield: Shield,
  siren: Siren,
  gavel: Gavel,
  scroll: Scroll,
  "trending-up": TrendingUp,
  star: Star,
  lightbulb: Lightbulb,
  gift: Gift,
  list: List,
  mic: Mic,
  hash: Hash,
  printer: Printer,
  book: BookOpen,
};

const DATA_LINKS = [
  { to: "", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "tickets-data", label: "Ticket queue", icon: Ticket },
  { to: "cases", label: "Moderation log", icon: Gavel },
  { to: "knowledge", label: "Knowledge base", icon: BookOpen },
  { to: "members", label: "Levels", icon: Users },
  { to: "audit", label: "Audit log", icon: Activity },
];

const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { guildId, meta } = useGuildMeta();
  const schema = useQuery({ queryKey: ["schema"], queryFn: getSchema, staleTime: Infinity });

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
      isActive ? "bg-brand-500/12 font-medium text-brand-200" : "text-ink-300 hover:bg-ink-800 hover:text-ink-100",
    );

  const warnings = meta?.warnings ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-800 p-4">
        <NavLink to="/guilds" className="flex items-center gap-2 text-xs text-ink-400 transition hover:text-ink-200">
          <ChevronLeft className="h-3.5 w-3.5" /> All servers
        </NavLink>
        <div className="mt-3 flex items-center gap-3">
          {meta?.iconUrl ? (
            <img src={meta.iconUrl} alt="" className="h-10 w-10 rounded-xl object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-800 text-sm font-bold text-ink-400">
              {meta?.name?.[0] ?? "?"}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-100">{meta?.name ?? "Loading…"}</p>
            <p className="text-xs text-ink-500">{meta ? `${meta.memberCount.toLocaleString()} members` : ""}</p>
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <NavLink
          to={`/guilds/${guildId}`}
          onClick={onNavigate}
          className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200 transition hover:bg-amber-500/10"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {warnings.length} setup {warnings.length === 1 ? "issue" : "issues"} need attention
          </span>
        </NavLink>
      )}

      <nav className="flex-1 space-y-6 overflow-y-auto p-3">
        <div>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Server</p>
          <div className="space-y-0.5">
            {DATA_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={`/guilds/${guildId}/${link.to}`}
                end={link.end}
                onClick={onNavigate}
                className={linkClass}
              >
                <link.icon className="h-4 w-4 shrink-0" />
                {link.label}
              </NavLink>
            ))}
          </div>
        </div>

        {schema.data?.groups.map((group) => (
          <div key={group.group}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">{group.group}</p>
            <div className="space-y-0.5">
              {group.modules.map((module) => {
                const Icon = ICONS[module.icon] ?? Settings;
                const hasWarning = warnings.some((w) => w.module === module.name);
                return (
                  <NavLink
                    key={module.name}
                    to={`/guilds/${guildId}/${module.name}`}
                    onClick={onNavigate}
                    className={linkClass}
                    title={module.description}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{module.title}</span>
                    {hasWarning && <AlertTriangle className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-400" />}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}

        {schema.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner className="text-ink-500" />
          </div>
        )}
      </nav>
    </div>
  );
};

const TopBar = ({ onMenu }: { onMenu: () => void }) => {
  const me = useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: Infinity });
  const health = useQuery({ queryKey: ["bot-health"], queryFn: getBotHealth, refetchInterval: 30_000, retry: false });
  const [menuOpen, setMenuOpen] = useState(false);

  const online = health.data?.bot?.ok;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-ink-800 bg-ink-950/85 px-4 backdrop-blur">
      <button type="button" onClick={onMenu} className="btn-ghost h-9 w-9 p-0 lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>

      <div className="hidden items-center gap-2 lg:flex">
        <Bot className="h-4 w-4 text-brand-400" />
        <span className="text-sm font-semibold tracking-tight">Bambot</span>
      </div>

      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] sm:flex",
            online
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-300",
          )}
          title={online ? `Gateway ping ${health.data?.bot?.ping} ms` : "The bot process is not responding"}
        >
          <span className={clsx("h-1.5 w-1.5 rounded-full", online ? "bg-emerald-400" : "bg-red-400")} />
          {online ? "Bot online" : "Bot offline"}
        </span>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-ink-800"
          >
            {me.data?.user.avatarUrl ? (
              <img src={me.data.user.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
            ) : (
              <div className="h-7 w-7 rounded-full bg-ink-700" />
            )}
            <span className="hidden text-sm text-ink-200 sm:block">{me.data?.user.username ?? "…"}</span>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-40 mt-1 w-44 rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-panel">
                <NavLink to="/guilds" className="block rounded px-3 py-2 text-sm text-ink-200 hover:bg-ink-800">
                  Switch server
                </NavLink>
                <button
                  type="button"
                  onClick={async () => {
                    await logout().catch(() => undefined);
                    window.location.href = "/login";
                  }}
                  className="block w-full rounded px-3 py-2 text-left text-sm text-red-300 hover:bg-ink-800"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export const GuildLayout = () => {
  const { guildId = "" } = useParams();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [guildId]);

  return (
    <GuildProvider guildId={guildId}>
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-ink-800 bg-ink-900/40 lg:block">
          <div className="sticky top-0 h-screen">
            <SidebarContent />
          </div>
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
            <aside className="absolute left-0 top-0 h-full w-72 animate-slide-up border-r border-ink-800 bg-ink-950">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="btn-ghost absolute right-2 top-2 h-8 w-8 p-0"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenu={() => setMobileOpen(true)} />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
            <Outlet />
          </main>
        </div>
      </div>
    </GuildProvider>
  );
};

export default GuildLayout;
