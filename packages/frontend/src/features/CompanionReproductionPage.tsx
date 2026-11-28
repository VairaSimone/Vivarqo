import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDate, todayDate } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { useResource } from "../hooks/useResource";
import { Alert, Button, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, Panel, PanelHeader, Select, Textarea, useToast } from "../components/ui";

type AnimalOption = { id: string; name: string; species: string; sex: string };
type ReproductionStatus = "mated" | "pregnant" | "delivered" | "unsuccessful" | "cancelled";
type ReproductionRecord = {
  id: string;
  femaleAnimalId: string;
  maleAnimalId: string;
  matedAt: string;
  pregnancyConfirmedAt: string | null;
  expectedDueAt: string | null;
  deliveredAt: string | null;
  status: ReproductionStatus;
  totalBorn: number | null;
  liveBorn: number | null;
  stillborn: number | null;
  notes: string | null;
  female: AnimalOption;
  male: AnimalOption;
};
type ReproductionForm = {
  femaleAnimalId: string;
  maleAnimalId: string;
  matedAt: string;
  pregnancyConfirmedAt: string;
  expectedDueAt: string;
  deliveredAt: string;
  status: ReproductionStatus;
  totalBorn: string;
  liveBorn: string;
  stillborn: string;
  notes: string;
};
const emptyForm = (): ReproductionForm => ({
  femaleAnimalId: "",
  maleAnimalId: "",
  matedAt: todayDate(),
  pregnancyConfirmedAt: "",
  expectedDueAt: "",
  deliveredAt: "",
  status: "mated",
  totalBorn: "",
  liveBorn: "",
  stillborn: "",
  notes: "",
});

export function CompanionReproductionPage({ locale }: { locale: Locale }) {
  const it = locale === "it";
  const [form, setForm] = useState<ReproductionForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { toast, show } = useToast();

  const records = useResource<{ records: ReproductionRecord[] }>("/companion-reproductions");
  const females = useResource<{ animals: AnimalOption[] }>("/animals?category=dogs_cats&sex=female&status=active&page=1&pageSize=100");
  const males = useResource<{ animals: AnimalOption[] }>("/animals?category=dogs_cats&sex=male&status=active&page=1&pageSize=100");

  function editRecord(record: ReproductionRecord) {
    setEditing(record.id);
    setForm({
      femaleAnimalId: record.femaleAnimalId,
      maleAnimalId: record.maleAnimalId,
      matedAt: record.matedAt.slice(0, 10),
      pregnancyConfirmedAt: record.pregnancyConfirmedAt?.slice(0, 10) ?? "",
      expectedDueAt: record.expectedDueAt?.slice(0, 10) ?? "",
      deliveredAt: record.deliveredAt?.slice(0, 10) ?? "",
      status: record.status,
      totalBorn: record.totalBorn == null ? "" : String(record.totalBorn),
      liveBorn: record.liveBorn == null ? "" : String(record.liveBorn),
      stillborn: record.stillborn == null ? "" : String(record.stillborn),
      notes: record.notes ?? "",
    });
    setError("");
  }

  function resetForm() {
    setEditing(null);
    setForm(emptyForm());
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      ...(editing ? {} : { femaleAnimalId: form.femaleAnimalId, maleAnimalId: form.maleAnimalId }),
      matedAt: form.matedAt,
      pregnancyConfirmedAt: form.pregnancyConfirmedAt || null,
      expectedDueAt: form.expectedDueAt || null,
      deliveredAt: form.deliveredAt || null,
      status: form.status,
      totalBorn: form.totalBorn === "" ? null : Number(form.totalBorn),
      liveBorn: form.liveBorn === "" ? null : Number(form.liveBorn),
      stillborn: form.stillborn === "" ? null : Number(form.stillborn),
      notes: form.notes.trim() || null,
    };
    try {
      if (editing) await api.patch("/companion-reproductions/" + encodeURIComponent(editing), payload);
      else await api.post("/companion-reproductions", payload);
      await records.reload();
      resetForm();
      show(it ? "Registro riproduttivo salvato." : "Reproduction record saved.");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : (it ? "Salvataggio non riuscito." : "Could not save reproduction record."));
    } finally {
      setSaving(false);
    }
  }

  async function removeRecord(record: ReproductionRecord) {
    if (!window.confirm(it ? "Eliminare questo registro riproduttivo?" : "Delete this reproduction record?")) return;
    try {
      await api.delete("/companion-reproductions/" + encodeURIComponent(record.id));
      await records.reload();
      if (editing === record.id) resetForm();
      show(it ? "Registro eliminato." : "Record deleted.");
    } catch (reason) {
      show(reason instanceof ApiError ? reason.message : (it ? "Eliminazione non riuscita." : "Could not delete record."));
    }
  }

  const statusLabel = (status: ReproductionStatus) => ({
    mated: it ? "Accoppiamento" : "Mated",
    pregnant: it ? "Gravidanza confermata" : "Pregnant",
    delivered: it ? "Parto completato" : "Delivered",
    unsuccessful: it ? "Non gravida / interrotta" : "Unsuccessful",
    cancelled: it ? "Annullato" : "Cancelled",
  })[status];

  return <div className="page-stack">
    <PageHeader
      eyebrow={it ? "CANI E GATTI" : "DOGS & CATS"}
      title={it ? "Riproduzione" : "Reproduction"}
      description={it
        ? "Registra accoppiamenti, conferme di gravidanza, date presunte del parto e cucciolate."
        : "Track matings, pregnancy confirmations, expected due dates and litters."}
    />

    <Panel>
      <PanelHeader
        title={editing ? (it ? "Modifica registro" : "Edit reproduction record") : (it ? "Nuovo accoppiamento" : "New mating")}
        description={it
          ? "Seleziona una femmina e un maschio della stessa specie. I genitori devono essere schede attive di cani o gatti."
          : "Select an active female and male of the same species. Both must be dog or cat profiles."}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {(females.error || males.error) && <Alert tone="danger">{it ? "Impossibile caricare l'elenco dei genitori." : "Could not load the parent list."}</Alert>}
      <form className="form-stack" onSubmit={save}>
        <div className="form-grid">
          <Field label={it ? "Femmina / madre" : "Female / mother"}>
            <Select required disabled={Boolean(editing)} value={form.femaleAnimalId} onChange={(event) => setForm((current) => ({ ...current, femaleAnimalId: event.target.value }))}>
              <option value="">{it ? "Seleziona femmina" : "Select female"}</option>
              {(females.data?.animals ?? []).map((animal) => <option key={animal.id} value={animal.id}>{animal.name} · {animal.species}</option>)}
            </Select>
          </Field>
          <Field label={it ? "Maschio / padre" : "Male / father"}>
            <Select required disabled={Boolean(editing)} value={form.maleAnimalId} onChange={(event) => setForm((current) => ({ ...current, maleAnimalId: event.target.value }))}>
              <option value="">{it ? "Seleziona maschio" : "Select male"}</option>
              {(males.data?.animals ?? []).map((animal) => <option key={animal.id} value={animal.id}>{animal.name} · {animal.species}</option>)}
            </Select>
          </Field>
          <Field label={it ? "Data accoppiamento" : "Mating date"}>
            <Input type="date" required value={form.matedAt} onChange={(event) => setForm((current) => ({ ...current, matedAt: event.target.value }))} />
          </Field>
          <Field label={it ? "Stato" : "Status"}>
            <Select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ReproductionStatus }))}>
              <option value="mated">{it ? "Accoppiamento" : "Mated"}</option>
              <option value="pregnant">{it ? "Gravidanza confermata" : "Pregnant"}</option>
              <option value="delivered">{it ? "Parto completato" : "Delivered"}</option>
              <option value="unsuccessful">{it ? "Non gravida / interrotta" : "Unsuccessful"}</option>
              <option value="cancelled">{it ? "Annullato" : "Cancelled"}</option>
            </Select>
          </Field>
          <Field label={it ? "Gravidanza confermata il" : "Pregnancy confirmed on"}>
            <Input type="date" value={form.pregnancyConfirmedAt} onChange={(event) => setForm((current) => ({ ...current, pregnancyConfirmedAt: event.target.value }))} />
          </Field>
          <Field label={it ? "Data presunta parto" : "Expected due date"}>
            <Input type="date" value={form.expectedDueAt} onChange={(event) => setForm((current) => ({ ...current, expectedDueAt: event.target.value }))} />
          </Field>
          <Field label={it ? "Data parto" : "Delivery date"}>
            <Input type="date" value={form.deliveredAt} onChange={(event) => setForm((current) => ({ ...current, deliveredAt: event.target.value }))} />
          </Field>
          <Field label={it ? "Cuccioli totali" : "Total offspring"}>
            <Input type="number" min="0" max="100" step="1" value={form.totalBorn} onChange={(event) => setForm((current) => ({ ...current, totalBorn: event.target.value }))} />
          </Field>
          <Field label={it ? "Nati vivi" : "Live-born"}>
            <Input type="number" min="0" max="100" step="1" value={form.liveBorn} onChange={(event) => setForm((current) => ({ ...current, liveBorn: event.target.value }))} />
          </Field>
          <Field label={it ? "Nati morti" : "Stillborn"}>
            <Input type="number" min="0" max="100" step="1" value={form.stillborn} onChange={(event) => setForm((current) => ({ ...current, stillborn: event.target.value }))} />
          </Field>
        </div>
        <Field label={it ? "Note" : "Notes"}>
          <Textarea rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </Field>
        {(!editing && ((females.data?.animals.length ?? 0) === 0 || (males.data?.animals.length ?? 0) === 0)) &&
          <p className="muted-note">{it ? "Per registrare un accoppiamento servono almeno una femmina e un maschio attivi della stessa specie." : "A mating requires at least one active female and one active male of the same species."}</p>}
        <div className="modal-actions">
          {editing && <Button type="button" variant="secondary" onClick={resetForm}>{it ? "Annulla modifica" : "Cancel edit"}</Button>}
          <Button type="submit" disabled={saving || (!editing && (!form.femaleAnimalId || !form.maleAnimalId))}>
            {saving ? (it ? "Salvataggio…" : "Saving…") : (it ? "Salva registro" : "Save record")}
          </Button>
        </div>
      </form>
    </Panel>

    <Panel>
      <PanelHeader title={it ? "Accoppiamenti e cucciolate" : "Matings and litters"} />
      {records.loading && !records.data ? <LoadingState /> : records.error ? <ErrorState message={records.error.message} retry={records.reload} /> :
        records.data?.records.length ? <div className="ecosys-history">{records.data.records.map((record) => <article className="ecosys-reading" key={record.id}>
          <strong>{record.female.name} × {record.male.name} · {statusLabel(record.status)}</strong>
          <span>
            {it ? "Accoppiamento " : "Mated "}{formatDate(record.matedAt, locale)}
            {record.pregnancyConfirmedAt ? " · " + (it ? "Gravidanza " : "Pregnancy ") + formatDate(record.pregnancyConfirmedAt, locale) : ""}
            {record.expectedDueAt ? " · " + (it ? "Parto previsto " : "Due ") + formatDate(record.expectedDueAt, locale) : ""}
            {record.deliveredAt ? " · " + (it ? "Parto " : "Delivered ") + formatDate(record.deliveredAt, locale) : ""}
          </span>
          {record.totalBorn != null && <small>{it ? "Cuccioli " : "Offspring "}{record.totalBorn} · {it ? "vivi " : "live "}{record.liveBorn ?? "—"} · {it ? "nati morti " : "stillborn "}{record.stillborn ?? "—"}</small>}
          {record.notes && <small>{record.notes}</small>}
          <div className="inline-actions">
            <Button size="sm" variant="secondary" onClick={() => editRecord(record)}>{it ? "Modifica" : "Edit"}</Button>
            <Button size="sm" variant="danger" onClick={() => void removeRecord(record)}>{it ? "Elimina" : "Delete"}</Button>
          </div>
        </article>)}</div> :
        <EmptyState title={it ? "Nessun accoppiamento registrato" : "No matings recorded"} description={it ? "Crea il primo registro per seguire gravidanza e cucciolata." : "Create the first record to track pregnancy and the litter."} />}
    </Panel>
    {toast}
  </div>;
}
