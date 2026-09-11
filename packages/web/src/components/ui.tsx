import { createContext, forwardRef, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, Check, ChevronDown, Info, Loader2, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={clsx("h-4 w-4 animate-spin", className)} aria-hidden />
);

export const Card = ({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={clsx("panel animate-fade-in", className)}>
    {(title || actions) && (
      <header className="flex items-start justify-between gap-4 border-b border-ink-700/60 px-5 py-4">
        <div className="min-w-0">
          {title && <h2 className="text-sm font-semibold tracking-wide text-ink-100">{title}</h2>}
          {description && <p className="mt-1 text-xs leading-relaxed text-ink-400">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
    )}
    <div className="px-5 py-5">{children}</div>
  </section>
);

export const Badge = ({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "brand";
}) => {
  const tones = {
    neutral: "bg-ink-800 text-ink-300 border-ink-700",
    success: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    warning: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    danger: "bg-red-500/10 text-red-300 border-red-500/30",
    info: "bg-sky-500/10 text-sky-300 border-sky-500/30",
    brand: "bg-brand-500/10 text-brand-300 border-brand-500/30",
  };
  return (
    <span className={clsx("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium", tones[tone])}>
      {children}
    </span>
  );
};

export const Toggle = ({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) => (
  <label className={clsx("flex items-start gap-3", disabled ? "opacity-50" : "cursor-pointer")}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors",
        checked ? "border-brand-500 bg-brand-500" : "border-ink-600 bg-ink-700",
      )}
    >
      <span
        className={clsx(
          "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
    {(label || description) && (
      <span className="min-w-0">
        {label && <span className="block text-sm font-medium text-ink-100">{label}</span>}
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">{description}</span>}
      </span>
    )}
  </label>
);

export const Field = ({
  label,
  hint,
  htmlFor,
  children,
  error,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  error?: string;
}) => (
  <div>
    {label && (
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
    )}
    <div className={clsx(label && "mt-1.5")}>{children}</div>
    {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
  </div>
);

// Refs are forwarded so the variable inserter can restore the caret position.
export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
  <input ref={ref} {...props} className={clsx("input", props.className)} />
));
TextInput.displayName = "TextInput";

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>((props, ref) => (
  <textarea
    ref={ref}
    {...props}
    className={clsx("input min-h-[96px] resize-y font-sans leading-relaxed", props.className)}
  />
));
TextArea.displayName = "TextArea";

export const Select = ({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; description?: string }[];
  placeholder?: string;
  className?: string;
}) => (
  <div className={clsx("relative", className)}>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="input appearance-none pr-9"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
  </div>
);

export const EmptyState = ({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
    {icon && <div className="text-ink-500">{icon}</div>}
    <div>
      <p className="text-sm font-medium text-ink-200">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-400">{description}</p>}
    </div>
    {action}
  </div>
);

export const Alert = ({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: ReactNode;
  children?: ReactNode;
}) => {
  const config = {
    info: { icon: Info, cls: "border-sky-500/30 bg-sky-500/5 text-sky-200" },
    warning: { icon: AlertTriangle, cls: "border-amber-500/30 bg-amber-500/5 text-amber-200" },
    danger: { icon: AlertTriangle, cls: "border-red-500/30 bg-red-500/5 text-red-200" },
    success: { icon: Check, cls: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200" },
  }[tone];
  const Icon = config.icon;

  return (
    <div className={clsx("flex gap-3 rounded-lg border px-4 py-3 text-sm", config.cls)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={clsx("text-xs leading-relaxed opacity-90", title && "mt-1")}>{children}</div>}
      </div>
    </div>
  );
};

export const Modal = ({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8">
      <div
        className={clsx("panel my-auto w-full animate-slide-up", wide ? "max-w-4xl" : "max-w-xl")}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-center justify-between gap-4 border-b border-ink-700/60 px-5 py-4">
          <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost -mr-2 h-8 w-8 p-0" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-ink-700/60 px-5 py-4">{footer}</footer>}
      </div>
    </div>
  );
};

export const Tabs = ({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: ReactNode; badge?: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}) => (
  <div className="flex gap-1 overflow-x-auto border-b border-ink-700/60 scrollbar-none">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => onChange(tab.id)}
        className={clsx(
          "relative whitespace-nowrap px-3.5 py-2.5 text-sm transition",
          active === tab.id ? "text-brand-300" : "text-ink-400 hover:text-ink-200",
        )}
      >
        <span className="flex items-center gap-2">
          {tab.label}
          {tab.badge}
        </span>
        {active === tab.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" />}
      </button>
    ))}
  </div>
);

export const StatCard = ({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "brand" | "warning" | "danger";
  icon?: ReactNode;
}) => (
  <div className="panel px-4 py-4">
    <div className="flex items-start justify-between gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      {icon && <span className="text-ink-500">{icon}</span>}
    </div>
    <p
      className={clsx(
        "mt-2 text-2xl font-semibold tabular-nums",
        tone === "brand" && "text-brand-300",
        tone === "warning" && "text-amber-300",
        tone === "danger" && "text-red-300",
        tone === "neutral" && "text-ink-100",
      )}
    >
      {value}
    </p>
    {sub && <p className="mt-1 text-xs text-ink-400">{sub}</p>}
  </div>
);

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  message: string;
}

const ToastContext = createContext<{ push: (tone: Toast["tone"], message: string) => void }>({ push: () => {} });

export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = (tone: Toast["tone"], message: string) => {
    const id = (counter.current += 1);
    setToasts((current) => [...current, { id, tone, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  };

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              "pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-panel backdrop-blur",
              toast.tone === "success" && "border-emerald-500/40 bg-emerald-950/90 text-emerald-100",
              toast.tone === "error" && "border-red-500/40 bg-red-950/90 text-red-100",
              toast.tone === "info" && "border-ink-600 bg-ink-850/95 text-ink-100",
            )}
          >
            {toast.tone === "success" ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
            ) : toast.tone === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <p className="min-w-0 flex-1 leading-relaxed">{toast.message}</p>
            <button
              type="button"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              className="opacity-60 transition hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

/** A sticky bar that only appears once something is actually unsaved. */
export const SaveBar = ({
  dirty,
  saving,
  onSave,
  onReset,
  error,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  error?: string | null;
}) => {
  const id = useId();
  if (!dirty && !error) return null;

  return (
    <div className="sticky bottom-4 z-30 mt-6 animate-slide-up" key={id}>
      <div className="panel flex flex-wrap items-center justify-between gap-3 border-brand-500/40 bg-ink-900/95 px-4 py-3 shadow-glow">
        <p className="text-sm text-ink-200">
          {error ? <span className="text-red-300">{error}</span> : "You have unsaved changes."}
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={onReset} disabled={saving}>
            Discard
          </button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={saving}>
            {saving && <Spinner />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
};
