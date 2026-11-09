import type { FormEvent } from "react";
import type { Locale } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import { Alert, Button, Field, Input, Modal, Textarea } from "../../components/ui";

export interface ClutchForm {
  laidOn: string;
  eggCount: string;
  status: string;
  incubatorLabel: string;
  incubationStartedAt: string;
  notes: string;
}

interface Props {
  locale: Locale;
  isEditing: boolean;
  form: ClutchForm;
  onChange: (form: ClutchForm) => void;
  error: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ClutchEditor({ locale, isEditing, form, onChange, error, busy, onClose, onSubmit }: Props) {
  const t = (key: string) => translate(locale, key);
  return <Modal title={isEditing ? t("edit") : t("addClutch")} onClose={onClose}>
    <form className="form-stack" onSubmit={onSubmit}>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="form-grid">
        <Field label={t("laidOn")}><Input required type="date" value={form.laidOn} onChange={(e) => onChange({ ...form, laidOn: e.target.value })} /></Field>
        <Field label={t("eggCount")}><Input required type="number" min="0" value={form.eggCount} onChange={(e) => onChange({ ...form, eggCount: e.target.value })} /></Field>
      </div>
      <Field label={t("status")}><Input value={form.status} onChange={(e) => onChange({ ...form, status: e.target.value })} /></Field>
      <Field label={t("incubator")}><Input value={form.incubatorLabel} onChange={(e) => onChange({ ...form, incubatorLabel: e.target.value })} /></Field>
      <Field label={t("notes")}><Textarea rows={3} value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} /></Field>
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={onClose}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
    </form>
  </Modal>;
}
