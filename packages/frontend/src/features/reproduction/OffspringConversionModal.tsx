import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { celsiusToTemperature, formatDate, formatDateTime, formatTemperature, getArray, getString, localDateTimeValue, queryString, temperatureToCelsius, temperatureUnitLabel, todayDate } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { useResource } from "../hooks/useResource";
import { RemoteSelect } from "../components/RemoteSelect";
import { Alert, Badge, Button, DataTable, EmptyState, ErrorState, Field, Icon, IconButton, Input, LoadingState, Modal, PageHeader, Pagination, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";
export function OffspringConversionModal({ batch, locale, busy, onClose, onSubmit }: {
  batch: OffspringBatchDto; locale: Locale; busy: boolean; onClose: () => void; onSubmit: (names: string[], species: string) => Promise<void>;
}) {
  const t = (key: string) => translate(locale, key);
  const maximum = Math.max(1, Math.min(10000, batch.count || 1));
  const [species, setSpecies] = useState("");
  const [names, setNames] = useState<string[]>([""]);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanNames = names.map((name) => name.trim()).filter(Boolean);
    if (!species.trim()) { setError(locale === "it" ? "Inserisci la specie dei piccoli." : "Enter the offspring species."); return; }
    if (!cleanNames.length) { setError(locale === "it" ? "Inserisci almeno un nome." : "Enter at least one name."); return; }
    if (cleanNames.length > maximum) { setError(locale === "it" ? `Puoi creare al massimo ${maximum} animali per questo gruppo.` : `You can create at most ${maximum} animals for this batch.`); return; }
    setError(""); await onSubmit(cleanNames, species.trim());
  }
  return <Modal title={t("convertToAnimals")} onClose={onClose} wide>
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("species")}><Input required maxLength={120} value={species} onChange={(event) => setSpecies(event.target.value)} /></Field>
      <div className="subsection-heading"><h3>{locale === "it" ? "Nomi dei piccoli" : "Offspring names"}</h3><span>{names.filter((name) => name.trim()).length} / {maximum}</span></div>
      {names.map((name, index) => <div className="form-grid" key={index}>
        <Field label={(locale === "it" ? "Nome" : "Name") + " " + (index + 1)}><Input required maxLength={120} value={name} onChange={(event) => setNames((current) => current.map((value, i) => i === index ? event.target.value : value))} /></Field>
        <div className="field"><span className="field-label">&nbsp;</span><Button type="button" variant="ghost" disabled={names.length <= 1} onClick={() => setNames((current) => current.filter((_, i) => i !== index))}>{locale === "it" ? "Rimuovi" : "Remove"}</Button></div>
      </div>)}
      <Button type="button" variant="secondary" disabled={names.length >= maximum} onClick={() => setNames((current) => [...current, ""])}><Icon name="plus" />{locale === "it" ? "Aggiungi un nome" : "Add another name"}</Button>
      <p className="muted-note">{locale === "it" ? "Verrà creato un animale per ogni nome compilato. I dati originali del gruppo resteranno invariati." : "One animal will be created for each completed name. The original batch record will remain unchanged."}</p>
      <div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{busy ? t("loading") : t("convertToAnimals")}</Button></div>
    </form>
  </Modal>;
}