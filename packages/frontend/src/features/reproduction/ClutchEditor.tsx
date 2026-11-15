import type { FormEvent } from "react";
import type { Locale } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import type { IncubatorDto } from "@vivarqo/contracts/reproduction";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "../../components/ui";

export interface ClutchForm {
  laidOn: string;
  eggCount: string;
  status: string;
  incubatorLabel: string;
  incubatorId: string;
  incubationStartedAt: string;
  targetTemperatureMinC: string;
  targetTemperatureMaxC: string;
  targetHumidityMinPct: string;
  targetHumidityMaxPct: string;
  checkIntervalHours: string;
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
  incubators: IncubatorDto[];
  onAddIncubator: () => void;
}

export function ClutchEditor({ locale, isEditing, form, onChange, error, busy, onClose, onSubmit, incubators, onAddIncubator }: Props) {
  const t = (key: string) => translate(locale, key);
  return <Modal title={isEditing ? t("edit") : t("addClutch")} onClose={onClose}>
    <form className="form-stack" onSubmit={onSubmit}>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="form-grid">
        <Field label={t("laidOn")}><Input required type="date" value={form.laidOn} onChange={(e) => onChange({ ...form, laidOn: e.target.value })} /></Field>
        <Field label={t("eggCount")}><Input required type="number" min="0" value={form.eggCount} onChange={(e) => onChange({ ...form, eggCount: e.target.value })} /></Field>
      </div>
      <Field label={t("status")}><Input value={form.status} onChange={(e) => onChange({ ...form, status: e.target.value })} /></Field>
      <div className="form-grid">
        <Field label={locale === "it" ? "Incubatrice registrata" : "Managed incubator"}>
          <Select value={form.incubatorId} onChange={(e) => onChange({ ...form, incubatorId: e.target.value })}>
            <option value="">{locale === "it" ? "Nessuna selezionata" : "None selected"}</option>
            {incubators.map((incubator) => <option key={incubator.id} value={incubator.id}>{incubator.name}{incubator.identifier ? ` · ${incubator.identifier}` : ""}</option>)}
          </Select>
          <Button type="button" size="sm" variant="secondary" onClick={onAddIncubator}>{locale === "it" ? "Nuova incubatrice" : "Add incubator"}</Button>
        </Field>
        <Field label={locale === "it" ? "Etichetta / posizione" : "Label / location"}><Input value={form.incubatorLabel} onChange={(e) => onChange({ ...form, incubatorLabel: e.target.value })} /></Field>
      </div>
      <div className="animal-editor-section">
        <h3>{locale === "it" ? "Parametri obiettivo incubazione" : "Incubation target ranges"}</h3>
        <div className="form-grid">
          <Field label={locale === "it" ? "Temperatura minima (°C)" : "Minimum temperature (°C)"}><Input type="number" step="0.1" value={form.targetTemperatureMinC} onChange={(e) => onChange({ ...form, targetTemperatureMinC: e.target.value })} /></Field>
          <Field label={locale === "it" ? "Temperatura massima (°C)" : "Maximum temperature (°C)"}><Input type="number" step="0.1" value={form.targetTemperatureMaxC} onChange={(e) => onChange({ ...form, targetTemperatureMaxC: e.target.value })} /></Field>
          <Field label={locale === "it" ? "Umidità minima (%)" : "Minimum humidity (%)"}><Input type="number" min="0" max="100" step="0.1" value={form.targetHumidityMinPct} onChange={(e) => onChange({ ...form, targetHumidityMinPct: e.target.value })} /></Field>
          <Field label={locale === "it" ? "Umidità massima (%)" : "Maximum humidity (%)"}><Input type="number" min="0" max="100" step="0.1" value={form.targetHumidityMaxPct} onChange={(e) => onChange({ ...form, targetHumidityMaxPct: e.target.value })} /></Field>
          <Field label={locale === "it" ? "Promemoria controllo (ore)" : "Check reminder (hours)"}><Input type="number" min="1" max="720" step="1" value={form.checkIntervalHours} onChange={(e) => onChange({ ...form, checkIntervalHours: e.target.value })} /></Field>
        </div>
        <p className="muted-note">{locale === "it" ? "Gli intervalli sono riferimenti configurabili: imposta valori adeguati alla specie e alle indicazioni veterinarie/allevatoriali." : "These are configurable reference ranges: set values appropriate to the species and husbandry guidance."}</p>
      </div>
      <Field label={t("notes")}><Textarea rows={3} value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} /></Field>
      <div className="modal-actions"><Button variant="secondary" type="button" onClick={onClose}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
    </form>
  </Modal>;
}
