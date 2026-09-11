import { useSearchParams } from "react-router-dom";
import { Bot, Gavel, LineChart, Printer, Shield, Ticket } from "lucide-react";
import { loginUrl } from "../lib/api";
import { Alert } from "../components/ui";

const ERRORS: Record<string, string> = {
  missing_code: "Discord did not send an authorisation code. Try again.",
  state_mismatch: "That sign-in link expired or was tampered with. Start again.",
  oauth_failed: "Discord rejected the sign-in. Check the client secret and redirect URI.",
};

const FEATURES = [
  { icon: Ticket, title: "Support tickets", body: "Multi-category panels, intake forms, claiming, SLAs and HTML transcripts." },
  { icon: Printer, title: "Bambu Lab tools", body: "HMS decoding, filament profiles, release watching and print cost maths." },
  { icon: Shield, title: "Automod & anti-raid", body: "Twelve filters, a scam scorer and automatic lockdown when a raid starts." },
  { icon: Gavel, title: "Full case book", body: "Every action recorded, searchable, with appeals and warn thresholds." },
  { icon: LineChart, title: "Real analytics", body: "Joins, messages, ticket load, response times and CSAT over time." },
];

export const LoginPage = () => {
  const [params] = useSearchParams();
  const error = params.get("error");
  const returnTo = params.get("returnTo") ?? "/guilds";

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight">Bambot</p>
              <p className="text-xs text-ink-400">Community control panel</p>
            </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-400">
            Bambot uses your Discord account. You will only see the servers where you have Manage Server.
          </p>

          {error && (
            <div className="mt-5">
              <Alert tone="danger" title="Sign-in failed">
                {ERRORS[error] ?? "Something went wrong. Try again."}
              </Alert>
            </div>
          )}

          <a href={loginUrl(returnTo)} className="btn-primary mt-6 w-full py-2.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
              <path d="M20.32 4.37A19.8 19.8 0 0 0 15.43 3l-.24.44a18.4 18.4 0 0 1 4.36 1.4 15.6 15.6 0 0 0-11.1 0 18.4 18.4 0 0 1 4.36-1.4L12.57 3a19.8 19.8 0 0 0-4.89 1.37C4.6 8.95 3.77 13.4 4.18 17.8a19.9 19.9 0 0 0 6.07 3.06l.73-1a13 13 0 0 1-2.24-1.08l.55-.43a14.2 14.2 0 0 0 11.42 0l.55.43a13 13 0 0 1-2.24 1.08l.73 1a19.9 19.9 0 0 0 6.07-3.06c.48-5.1-.82-9.51-3.5-13.43ZM9.68 15.1c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Zm4.64 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Z" />
            </svg>
            Continue with Discord
          </a>

          <p className="mt-4 text-center text-xs text-ink-500">
            Bambot only requests <span className="text-ink-300">identify</span> and{" "}
            <span className="text-ink-300">guilds</span>. It never reads your messages through OAuth.
          </p>
        </div>
      </div>

      <div className="relative hidden overflow-hidden border-l border-ink-800 bg-ink-900/50 lg:block">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(#00AE42 1px, transparent 1px), linear-gradient(90deg, #00AE42 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative flex h-full flex-col justify-center px-12 py-16">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Built for the Bambu Lab community</p>
          <h2 className="mt-3 max-w-md text-3xl font-semibold leading-tight tracking-tight">
            One place to run the server, not six different bots.
          </h2>

          <div className="mt-10 space-y-5">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex gap-3.5">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink-700 bg-ink-850">
                  <feature.icon className="h-4 w-4 text-brand-400" />
                </div>
                <div className="max-w-sm">
                  <p className="text-sm font-medium text-ink-100">{feature.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{feature.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
