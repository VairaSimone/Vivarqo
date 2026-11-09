import type { FormEvent } from "react";
import type { Locale } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import { RemoteSelect } from "../../components/RemoteSelect";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { eventTypes } from "./types";
import { temperatureUnitLabel } from "../../lib/domain";

export interface ReproductiveEventForm {
  eventType: string;
  occurredAt: string;
  animalId: string;
  details: string;
  temperatureC: string;
  humidityPct: string;
}

interface Props {
  locale: Locale;
  isEditing: boolean;
  form: ReproductiveEventForm;
  onChange: (form: ReproductiveEventForm) => void;
  error: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ReproductiveEventEditor({ locale, isEditing, form, onChange, error, busy, onClose, onSubmit }: Props) {
  const t = (key: string) => translate(locale, key);
  return <Modal title={isEditing ? t("edit") : t("addEvent")} onClose={onClose}>
    <form className="form-stack" onSubmit={onSubmit}>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("eventType")}><Select value={form.eventType} onChange={(e) => onChange({ ...form, eventType: e.target.value })}>{eventTypes.map((value) => <option key={value} value={value}>{t(`event_${value}`)}</option>)}</Select></Field>
      <Field label={t("occurredAt")}><Input required type="datetime-local" value={form.occurredAt} onChange={(e) => onChange({ ...form, occurredAt: e.target.value })} /></Field>
      <RemoteSelect label={t("animalDetail")} value={form.animalId} onChange={(animalId) => onChange({ ...form, animalId })} endpoint="/animals" responseKey="animals" filters={{ status: "active", sort: "name" }} detailEndpoint={(animalId) => `/animals/${encodeURIComponent(animalId)}`} detailKey="animal" locale={locale} />
      <div className="form-grid">
        <Field label={`${t("temperature").replace(/°C|°F/, temperatureUnitLabel())}`}><Input type="number" step="0.1" value={form.temperatureC} onChange={(e) => onChange({ ...form, temperatureC: e.target.value })} /></Field>
        <Field label={t("humidity")}><Input type="number" min="0" max="100" step="0.1" value={form.humidityPct} onChange={(e) => onChange({ ...form, humidityPct: e.target.value })} /></Field>
      </div>
      <Field label={t("notes")}><Textarea rows={3} value={form.details} onChange={(e) => onChange({ ...form, details: e.target.value })} /></Field>
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={onClose}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
    </form>
  </Modal>;
}
