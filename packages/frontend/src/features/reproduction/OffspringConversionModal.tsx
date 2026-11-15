import { useState, type FormEvent } from "react";
import type { ClutchDetailDto, OffspringBatchDto } from "@vivarqo/contracts/reproduction";
import type { Locale } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import { useResource } from "../../hooks/useResource";
import { Alert, Button, Field, Icon, Input, Modal, Select, Textarea } from "../../components/ui";

export interface OffspringAnimalDraft {
  name: string;
  species: string;
  sex: "male" | "female" | "unknown";
  morph: string;
  identifier: string;
  geneticsNotes: string;
  birthDate: string;
  birthDateEstimated: boolean;
  acquiredDate: string;
  originDescription: string;
  locationLabel: string;
  notes: string;
  photo: File | null;
  eggId: string;
}
const emptyAnimal = (): OffspringAnimalDraft => ({
  name: "", species: "", sex: "unknown", morph: "", identifier: "",
  geneticsNotes: "", birthDate: "", birthDateEstimated: false, acquiredDate: "", originDescription: "Nato in allevamento",
  locationLabel: "", notes: "", photo: null, eggId: "",
});

export function OffspringConversionModal({ batch, locale, busy, onClose, onSubmit }: {
  batch: OffspringBatchDto;
  locale: Locale;
  busy: boolean;
  onClose: () => void;
  onSubmit: (animals: OffspringAnimalDraft[]) => Promise<void>;
}) {
  const t = (key: string) => translate(locale, key);
  const maximum = Math.max(1, Math.min(500, batch.count || 1));
  const [animals, setAnimals] = useState<OffspringAnimalDraft[]>([emptyAnimal()]);
  const clutchResource = useResource<{ clutch: ClutchDetailDto }>(batch.clutchId ? `/clutches/${encodeURIComponent(batch.clutchId)}` : null);
  const availableEggs = (clutchResource.data?.clutch.eggs ?? []).filter((egg) => !egg.offspringAnimalId);
  const [error, setError] = useState("");
  const update = (index: number, patch: Partial<OffspringAnimalDraft>) =>
    setAnimals((current) => current.map((animal, i) => i === index ? { ...animal, ...patch } : animal));
  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = animals.map((animal) => ({ ...animal, name: animal.name.trim(), species: animal.species.trim() }));
    if (clean.some((animal) => !animal.name || !animal.species)) {
      setError(locale === "it" ? "Nome e specie sono obbligatori per ogni piccolo." : "Name and species are required for every offspring.");
      return;
    }
    const identifiers = clean.map((animal) => animal.identifier.trim().toLocaleLowerCase()).filter(Boolean);
    if (new Set(identifiers).size !== identifiers.length) {
      setError(locale === "it" ? "Gli identificativi devono essere univoci." : "Identifiers must be unique.");
      return;
    }
    setError("");
    await onSubmit(clean);
  }
  return <Modal title={t("convertToAnimals")} onClose={onClose} wide>
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="subsection-heading">
        <h3>{locale === "it" ? "Schede individuali" : "Individual profiles"}</h3>
        <span>{animals.length} / {maximum}</span>
      </div>
      <p className="muted-note">{locale === "it"
        ? "Ogni piccolo diventa una scheda animale completa. Madre, padre e covata vengono collegati automaticamente al ciclo di provenienza."
        : "Each offspring becomes a full animal profile. Parents and clutch are linked automatically from the source cycle."}</p>
      {animals.map((animal, index) => <section className="animal-editor-section" key={index}>
        <div className="subsection-heading"><h3>{locale === "it" ? "Piccolo" : "Offspring"} {index + 1}</h3>
          <Button type="button" variant="ghost" disabled={animals.length <= 1} onClick={() => setAnimals((current) => current.filter((_, i) => i !== index))}>{locale === "it" ? "Rimuovi" : "Remove"}</Button>
        </div>
        <div className="form-grid">
          <Field label={t("name")}><Input required maxLength={120} value={animal.name} onChange={(e) => update(index, { name: e.target.value })} /></Field>
          <Field label={t("identifier")}><Input maxLength={120} value={animal.identifier} onChange={(e) => update(index, { identifier: e.target.value })} /></Field>
          <Field label={t("species")}><Input required maxLength={160} value={animal.species} onChange={(e) => update(index, { species: e.target.value })} /></Field>
          <Field label={t("sex")}><Select value={animal.sex} onChange={(e) => update(index, { sex: e.target.value as OffspringAnimalDraft["sex"] })}>
            <option value="unknown">{t("unknown")}</option><option value="male">{t("male")}</option><option value="female">{t("female")}</option>
          </Select></Field>
          <Field label={t("morph")}><Input maxLength={200} value={animal.morph} onChange={(e) => update(index, { morph: e.target.value })} /></Field>
          <Field label={t("birthDate")}><Input type="date" value={animal.birthDate || batch.bornOn} onChange={(e) => update(index, { birthDate: e.target.value })} /></Field>
          <Field label={t("location")}><Input maxLength={160} value={animal.locationLabel} onChange={(e) => update(index, { locationLabel: e.target.value })} /></Field>
          <Field label={locale === "it" ? "Data acquisizione" : "Acquired date"}><Input type="date" value={animal.acquiredDate} onChange={(e) => update(index, { acquiredDate: e.target.value })} /></Field>
          <Field label={locale === "it" ? "Uovo di origine" : "Source egg"}><Select value={animal.eggId} disabled={!batch.clutchId || clutchResource.loading} onChange={(e) => update(index, { eggId: e.target.value })}>
            <option value="">{locale === "it" ? "Non collegare un uovo" : "Do not link an egg"}</option>
            {availableEggs.map((egg) => <option key={egg.id} value={egg.id}>{egg.code || egg.id.slice(0, 8)} · {egg.status}</option>)}
          </Select></Field>
          <Field label={locale === "it" ? "Foto (JPG, PNG, WebP · max 5 MB)" : "Photo (JPG, PNG, WebP · max 5 MB)"}>
            <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              if (file && (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
                setError(t("photoValidation")); e.target.value = ""; return;
              }
              setError(""); update(index, { photo: file });
            }} />
          </Field>
        </div>
        <Field label={locale === "it" ? "Provenienza" : "Origin"}><Input maxLength={20000} value={animal.originDescription} onChange={(e) => update(index, { originDescription: e.target.value })} /></Field>
        <label className="checkbox-field"><input type="checkbox" checked={animal.birthDateEstimated} onChange={(e) => update(index, { birthDateEstimated: e.target.checked })} />{locale === "it" ? "Data di nascita stimata" : "Estimated birth date"}</label>
        <Field label={t("geneticsNotes")}><Textarea rows={2} value={animal.geneticsNotes} onChange={(e) => update(index, { geneticsNotes: e.target.value })} /></Field>
        <Field label={t("notes")}><Textarea rows={2} value={animal.notes} onChange={(e) => update(index, { notes: e.target.value })} /></Field>
      </section>)}
      <Button type="button" variant="secondary" disabled={animals.length >= maximum} onClick={() => setAnimals((current) => [...current, { ...emptyAnimal(), species: current[0]?.species ?? "" }])}>
        <Icon name="plus" />{locale === "it" ? "Aggiungi piccolo" : "Add offspring"}
      </Button>
      <div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{busy ? t("loading") : t("convertToAnimals")}</Button></div>
    </form>
  </Modal>;
}
