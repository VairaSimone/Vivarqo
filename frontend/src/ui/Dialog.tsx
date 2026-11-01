import React, { useEffect, useId, useRef, type ReactNode, type FormEvent } from "react";
import { t } from "../i18n";
import { Icon } from "./Icon";

export interface DialogProps {
  title: string;
  description?: string;
  children?: ReactNode;
  onClose?: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  size?: "normal" | "wide";
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function Dialog({
  title, description, children, onClose, onSubmit,
  submitLabel = "Salva", cancelLabel = "Annulla", busy = false,
  danger = false, size = "normal"
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  onCloseRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(element => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");

    const initialFocus = dialog.querySelector<HTMLElement>("[autofocus]") ??
      dialog.querySelector<HTMLElement>(
        "form input:not([type='hidden']):not([disabled]), form select:not([disabled]), form textarea:not([disabled]), form button:not([disabled])"
      ) ??
      getFocusable()[0] ??
      dialog;

    initialFocus.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !dialog.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !dialog.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!busy) onSubmit?.(event);
  };

  return <div className="modal-backdrop dialog-backdrop" role="presentation"
    onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose?.(); }}>
    <section ref={dialogRef} tabIndex={-1}
      className={"modal dialog-card " + (size === "wide" ? "dialog-card--wide" : "")}
      role="dialog" aria-modal="true" aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}>
      <header className="dialog-heading">
        <div>
          <p className="eyebrow">VIVARQO</p>
          <h2 id={titleId}>{t(title)}</h2>
          {description && <p id={descriptionId} className="subheading">{t(description)}</p>}
        </div>
        <button type="button" className="close-button" onClick={() => onClose?.()} disabled={busy}
          aria-label={t("Chiudi finestra")}><Icon name="close" size={19}/></button>
      </header>
      {onSubmit ? <form className="form-grid dialog-form" onSubmit={handleSubmit}>
        {children}
        <div className="form-actions form-full dialog-actions">
          <button type="button" className="button secondary" onClick={() => onClose?.()} disabled={busy}>{t(cancelLabel)}</button>
          <button type="submit" className={"button " + (danger ? "danger" : "primary")} disabled={busy}>
            {t(busy ? "Salvataggio…" : submitLabel)}
          </button>
        </div>
      </form> : <div className="dialog-content">{children}</div>}
    </section>
  </div>;
}
