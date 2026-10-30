import React, { useId, type ReactNode, type FormEvent } from "react";
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

export function Dialog({
  title, description, children, onClose, onSubmit,
  submitLabel = "Salva", cancelLabel = "Annulla", busy = false,
  danger = false, size = "normal"
}: DialogProps) {
  const titleId = useId();
  const handleSubmit = event => {
    event.preventDefault();
    if (!busy) onSubmit?.(event);
  };
  return <div className="modal-backdrop dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section className={"modal dialog-card " + (size === "wide" ? "dialog-card--wide" : "")} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="dialog-heading">
        <div><p className="eyebrow">VIVARQO</p><h2 id={titleId}>{title}</h2>{description && <p className="subheading">{description}</p>}</div>
        <button type="button" className="close-button" onClick={onClose} aria-label="Chiudi finestra"><Icon name="close" size={19}/></button>
      </header>
      {onSubmit ? <form className="form-grid dialog-form" onSubmit={handleSubmit}>
        {children}
        <div className="form-actions form-full dialog-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button type="submit" className={"button " + (danger ? "danger" : "primary")} disabled={busy}>{busy ? "Salvataggio…" : submitLabel}</button>
        </div>
      </form> : <div className="dialog-content">{children}</div>}
    </section>
  </div>;
}
