import { cloneElement, isValidElement, useEffect, useId, useState, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

type Tone = "success" | "warning" | "danger" | "info" | "primary" | "neutral";
export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, ReactNode> = {
    leaf: <><path d="M20 4c-7 0-13 3-13 10a6 6 0 0 0 6 6c7 0 10-6 7-16Z"/><path d="M3 21c3-5 7-8 13-11"/></>,
    home: <><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-6h6v6"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    check: <><path d="m5 12 4 4L19 6"/><path d="M21 12a9 9 0 1 1-4-7.5"/></>,
    snake: <><path d="M4 6c0-2 2-3 4-2l10 6c2 1 2 4 0 5l-7 4c-2 1-5 0-5-2s2-3 4-3h4"/><circle cx="8" cy="5" r="1"/></>,
    feed: <><path d="M4 7h16l-2 13H6z"/><path d="M8 7c0-3 2-4 4-4s4 1 4 4M8 12h8"/></>,
    box: <><path d="m3 7 9-4 9 4-9 5z"/><path d="M3 7v10l9 4 9-4V7M12 12v9"/></>,
    file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 15h2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19 13 2 1-2 4-2-1-2 1v2H9v-2l-2-1-2 1-2-4 2-1v-2l-2-1 2-4 2 1 2-1V4h4v2l2 1 2-1 2 4-2 1z"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    menu: <><path d="M3 6h18M3 12h18M3 18h18"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3M12 3h8v18h-8"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <><path d="M4 12h15M13 5l7 7-7 7"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5M4 21h16"/></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    edit: <><path d="m4 16-.8 4.8L8 20l12-12-4-4zM13.5 6.5l4 4"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
    archive: <><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M9 13h6"/></>,
    restore: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 9a7 7 0 0 1 12-3l3 3M4 12l3 3a7 7 0 0 0 12-3"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    alert: <><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3l-7.9-14.1a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
    weight: <><path d="M5 7h14l2 14H3z"/><path d="M12 11l2-2M12 11l-2-2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    egg: <path d="M12 3c4 0 7 6 7 11a7 7 0 0 1-14 0c0-5 3-11 7-11Z"/>,
    checkCircle: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>
  };
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? <circle cx="12" cy="12" r="8" />}</svg>;
}

export function Button({ children, variant = "primary", size = "md", className = "", type = "button", ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" }) {
  return <button type={type} className={["btn", variant === "primary" ? "btn-primary" : variant === "secondary" ? "btn-secondary" : variant === "danger" ? "btn-danger" : "btn-ghost", size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "", className].filter(Boolean).join(" ")} {...props}>{children}</button>;
}
export function IconButton({ children, label, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className={["icon-button", className].filter(Boolean).join(" ")} aria-label={label} title={label} {...props}>{children}</button>;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={"badge " + (tone === "neutral" ? "" : "badge-" + tone)}>{children}</span>;
}
export function Alert({ children, tone = "info" }: { children: ReactNode; tone?: "success" | "warning" | "danger" | "info" }) {
  return <div className={"alert " + (tone === "info" ? "" : "alert-" + tone)} role={tone === "danger" ? "alert" : "status"}><Icon name={tone === "success" ? "checkCircle" : "alert"} size={15} />{children}</div>;
}
type AccessibleControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

export function Field({ label, hint, error, children }: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const hintId = generatedId + "-hint";
  const errorId = generatedId + "-error";
  const control = isValidElement<AccessibleControlProps>(children)
    ? cloneElement(children, {
        id: children.props.id ?? generatedId + "-control",
        "aria-describedby": [
          children.props["aria-describedby"],
          hint ? hintId : undefined,
          error ? errorId : undefined
        ].filter(Boolean).join(" ") || undefined,
        "aria-invalid": error ? true : children.props["aria-invalid"]
      })
    : children;

  return <label className="field">
    <span className="field-label">{label}</span>
    {control}
    {hint && <small id={hintId} className="field-hint">{hint}</small>}
    {error && <small id={errorId} className="field-error" role="alert">{error}</small>}
  </label>;
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={["control", props.className].filter(Boolean).join(" ")} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={["control", props.className].filter(Boolean).join(" ")} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={["control", "textarea", props.className].filter(Boolean).join(" ")} />;
}
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={["panel", className].filter(Boolean).join(" ")}>{children}</section>;
}
export function PanelHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="panel-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action && <div className="inline-actions">{action}</div>}</div>;
}
export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="page-actions">{action}</div>}</header>;
}
export function LoadingState() {
  return <div className="loading-state" role="status" aria-label={typeof document !== "undefined" && document.documentElement.lang === "en" ? "Loading" : "Caricamento"}><span className="spinner" /></div>;
}
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name="leaf" size={20} /></span><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  const retryLabel = typeof document !== "undefined" && document.documentElement.lang === "en" ? "Retry" : "Riprova";
  return <div className="error-state" role="alert"><Icon name="alert" size={19} /><span>{message}</span>{retry && <Button size="sm" variant="secondary" onClick={retry}>{retryLabel}</Button>}</div>;
}
export function DataTable({ headers, rows, empty = "No records" }: { headers: string[]; rows: ReactNode[][]; empty?: string }) {
  const regionLabel = (typeof document !== "undefined" && document.documentElement.lang === "en" ? "Table: " : "Tabella: ") + headers.join(", ");
  return <div className="table-wrap" role="region" aria-label={regionLabel} tabIndex={0}>
    <table>
      <thead><tr>{headers.map((header,index) => <th key={header + index} scope="col">{header}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map((row,index) => <tr key={index}>{row.map((cell,cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length}><EmptyState title={empty} /></td></tr>}</tbody>
    </table>
  </div>;
}
export function Pagination({ page, totalPages, onChange, label = "Page" }: { page: number; totalPages: number; onChange: (page: number) => void; label?: string }) {
  if (totalPages <= 1) return null;
  const english = typeof document !== "undefined" && document.documentElement.lang === "en";
  return <div className="pagination"><span>{label} {page} / {totalPages}</span><div><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}><Icon name="chevron" size={13} />{english ? "Previous" : "Precedente"}</Button><Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>{english ? "Next" : "Successivo"}<Icon name="chevron" size={13} /></Button></div></div>;
}
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const closeLabel = typeof document !== "undefined" && document.documentElement.lang === "en" ? "Close" : "Chiudi";
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusableSelector = 'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter((element) =>
        !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
        element.getClientRects().length > 0
      );
    const first = () => focusable()[0] ?? dialog;
    first()?.focus();

    const onFocusIn = (event: FocusEvent) => {
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) first()?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const firstElement = elements[0]!;
      const lastElement = elements[elements.length - 1]!;
      if (event.shiftKey && (document.activeElement === firstElement || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (document.activeElement === lastElement || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}><section ref={dialogRef} tabIndex={-1} className={"modal " + (wide ? "modal-wide" : "")} role="dialog" aria-modal="true" aria-labelledby={titleId}><header className="modal-header"><h2 id={titleId}>{title}</h2><IconButton label={closeLabel} onClick={onClose}><Icon name="close" size={16} /></IconButton></header><div className="modal-content">{children}</div></section></div>;
}
export function useToast() {
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [message, version]);
  const show = (nextMessage: string) => { setMessage(nextMessage); setVersion((value) => value + 1); };
  const closeLabel = typeof document !== "undefined" && document.documentElement.lang === "en" ? "Close" : "Chiudi";
  const toast = message ? <div className="toast" role="status"><Icon name="checkCircle" size={16} /><span>{message}</span><IconButton label={closeLabel} onClick={() => setMessage("")}><Icon name="close" size={13} /></IconButton></div> : null;
  return { toast, show };
}
