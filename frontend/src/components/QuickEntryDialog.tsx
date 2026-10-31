import React, { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AnyRecord, NoticeHandler } from "../types";
import { errorMessage } from "../types";
import { apiRequest } from "../api/api";
import { Dialog } from "../ui/Dialog";
import { Area, Input, Select } from "../ui/FormControls";

export type QuickEntryKind = "feeding" | "weight" | "shed" | "note";
type WeightUnit = "g" | "kg" | "oz" | "lb";

const arrayOf = (value: unknown): AnyRecord[] =>
  Array.isArray(value) ? value as AnyRecord[] :
  value && typeof value === "object" ? Object.values(value as AnyRecord).find(Array.isArray) as AnyRecord[] ?? [] : [];

const localDateTime = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "T" + pad(now.getHours()) + ":" + pad(now.getMinutes());
};

const GRAMS_PER_UNIT: Record<WeightUnit, number> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
const SHED_OPTIONS = [["complete", "Completa"], ["partial", "Parziale"], ["unknown", "Non valutata"]] as const;
const FEED_OPTIONS = [["ate", "Ha mangiato"], ["refused", "Ha rifiutato"], ["not_offered", "Non offerto"], ["unknown", "Non noto"]] as const;

export function QuickEntryDialog({
  kind, weightUnit, onClose, onNotice, onSaved
}: {
  kind: QuickEntryKind;
  weightUnit: WeightUnit;
  onClose: () => void;
  onNotice: NoticeHandler;
  onSaved: () => void;
}) {
  const [animals, setAnimals] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [animalId, setAnimalId] = useState("");
  const [selectedAnimalIds, setSelectedAnimalIds] = useState<string[]>([]);
  const [occurredAt, setOccurredAt] = useState(localDateTime);
  const [weight, setWeight] = useState("");
  const [outcome, setOutcome] = useState(kind === "feeding" ? "ate" : "complete");
  const [foodType, setFoodType] = useState("Altro");
  const [foodSize, setFoodSize] = useState("");
  const [foodWeightG, setFoodWeightG] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("general");
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let live = true;
    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const first = await apiRequest<AnyRecord>("animals?page=1&pageSize=100&status=active");
        const list = arrayOf(first.animals ?? first);
        const totalPages = Math.max(1, Number(first.pagination?.totalPages ?? 1));
        const remaining = totalPages > 1
          ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) =>
              apiRequest<AnyRecord>("animals?page=" + (index + 2) + "&pageSize=100&status=active")
            ))
          : [];
        const all = [...list, ...remaining.flatMap(response => arrayOf(response.animals ?? response))];
        const unique = Array.from(new Map(all.filter(animal => animal.id).map(animal => [String(animal.id), animal])).values());
        if (!live) return;
        setAnimals(unique);
        setAnimalId(current => current || String(unique[0]?.id ?? ""));
      } catch (error) {
        if (live) setLoadError(errorMessage(error));
      } finally {
        if (live) setLoading(false);
      }
    };
    void load();
    return () => { live = false; };
  }, []);

  const animalOptions = useMemo(() => animals.map(animal => ({
    value: String(animal.id),
    label: String(animal.name || "Animale") + (animal.species ? " · " + animal.species : "")
  })), [animals]);

  const toggleAnimal = (id: string, checked: boolean) => {
    setSelectedAnimalIds(current => checked
      ? current.includes(id) ? current : [...current, id]
      : current.filter(value => value !== id));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (kind === "feeding" && selectedAnimalIds.length === 0) {
      onNotice("Scegli almeno un animale per la sessione.", "error");
      return;
    }
    if (kind !== "feeding" && !animalId) {
      onNotice("Scegli un animale prima di salvare.", "error");
      return;
    }
    const timestamp = new Date(occurredAt);
    if (Number.isNaN(timestamp.getTime())) {
      onNotice("Inserisci una data e ora valide.", "error");
      return;
    }
    setSaving(true);
    try {
      const iso = timestamp.toISOString();
      if (kind === "feeding") {
        await apiRequest("feeding-sessions", {
          method: "POST",
          body: {
            performedAt: iso,
            notes: notes.trim() || null,
            entries: selectedAnimalIds.map(id => ({
              animalId: id,
              outcome,
              foodType: foodType.trim() || "Altro",
              foodSize: foodSize.trim() || null,
              foodWeightG: foodWeightG === "" ? null : Number(foodWeightG),
              notes: null
            }))
          }
        });
        onNotice("Sessione di alimentazione registrata.", "success");
      } else if (kind === "weight") {
        const numericWeight = Number(weight);
        if (!Number.isFinite(numericWeight) || numericWeight <= 0) {
          onNotice("Inserisci un peso maggiore di zero.", "error");
          return;
        }
        await apiRequest("animals/" + encodeURIComponent(animalId) + "/weights", {
          method: "POST",
          body: { measuredAt: iso, weightG: numericWeight * GRAMS_PER_UNIT[weightUnit], notes: notes.trim() || null }
        });
        onNotice("Pesata registrata.", "success");
      } else if (kind === "shed") {
        await apiRequest("animals/" + encodeURIComponent(animalId) + "/sheds", {
          method: "POST",
          body: { occurredAt: iso, outcome, notes: notes.trim() || null }
        });
        onNotice("Muta registrata.", "success");
      } else {
        if (!body.trim()) {
          onNotice("Inserisci il testo dell'osservazione.", "error");
          return;
        }
        await apiRequest("animals/" + encodeURIComponent(animalId) + "/notes", {
          method: "POST",
          body: { occurredAt: iso, title: title.trim() || null, category: category.trim() || "general", body: body.trim() }
        });
        onNotice("Nota registrata.", "success");
      }
      onSaved();
      onClose();
    } catch (error) {
      onNotice(errorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  };

  const dialogTitle = kind === "feeding" ? "Nuova sessione di alimentazione" :
    kind === "weight" ? "Nuova pesata" : kind === "shed" ? "Nuova muta" : "Nuova nota";
  const dialogDescription = kind === "feeding" ? "Registra una sessione per uno o più animali." :
    kind === "weight" ? "Registra una pesata senza lasciare la dashboard." :
    "Registra una nota direttamente sulla scheda dell'animale.";

  return <Dialog title={dialogTitle} description={dialogDescription} onClose={onClose}
    onSubmit={submit} submitLabel="Registra" busy={saving || loading} size={kind === "feeding" ? "wide" : "normal"}>
    {loading ? <p className="muted form-full">Caricamento animali…</p> : loadError ? <p className="form-message form-full" role="alert">{loadError}</p> :
      animals.length === 0 ? <p className="muted form-full">Nessun animale attivo disponibile.</p> : <>
        {kind === "feeding" ? <>
          <Input label="Data e ora della sessione" name="performedAt" type="datetime-local" value={occurredAt} onChange={event => setOccurredAt(event.target.value)} required />
          <div className="form-full"><Area label="Note comuni" name="sessionNotes" value={notes} onChange={event => setNotes(event.target.value)} rows={2} /></div>
          <fieldset className="feeding-entry-form form-full">
            <legend>Seleziona gli animali alimentati</legend>
            <div className="feeding-animal-picker">
              {animals.map(animal => {
                const id = String(animal.id);
                return <label className="feeding-animal-option" key={id}>
                  <input type="checkbox" checked={selectedAnimalIds.includes(id)} onChange={event => toggleAnimal(id, event.target.checked)} />
                  <span><strong>{animal.name}</strong><small>{animal.species}{animal.identifier ? " · " + animal.identifier : ""}</small></span>
                </label>;
              })}
            </div>
          </fieldset>
          <Select label="Esito" name="outcome" options={FEED_OPTIONS as unknown as string[][]} value={outcome} onChange={event => setOutcome(event.target.value)} />
          <Input label="Tipo di alimento" name="foodType" value={foodType} onChange={event => setFoodType(event.target.value)} placeholder="Altro" />
          <Input label="Dimensione / quantità" name="foodSize" value={foodSize} onChange={event => setFoodSize(event.target.value)} />
          <Input label="Peso alimento (g)" name="foodWeightG" type="number" min={0.01} max={1000000} step={0.01} value={foodWeightG} onChange={event => setFoodWeightG(event.target.value)} />
        </> : <>
          <Select label="Seleziona un animale" name="animalId" options={animalOptions} value={animalId} onChange={event => setAnimalId(event.target.value)} required />
          <Input label={kind === "weight" ? "Data e ora della pesata" : kind === "note" ? "Data e ora dell'osservazione" : "Data e ora"} name="occurredAt" type="datetime-local" value={occurredAt} onChange={event => setOccurredAt(event.target.value)} required />
          {kind === "weight" && <Input label={"Peso (" + weightUnit + ")"} name="weight" type="number" min={0.001} step="any" value={weight} onChange={event => setWeight(event.target.value)} required />}
          {kind === "shed" && <Select label="Esito" name="outcome" options={SHED_OPTIONS as unknown as string[][]} value={outcome} onChange={event => setOutcome(event.target.value)} required />}
          {kind === "note" && <>
            <Input label="Titolo (facoltativo)" name="title" value={title} onChange={event => setTitle(event.target.value)} />
            <Input label="Categoria" name="category" value={category} onChange={event => setCategory(event.target.value)} required />
            <div className="form-full"><Area label="Osservazione" name="body" value={body} onChange={event => setBody(event.target.value)} required rows={4} /></div>
          </>}
          {(kind === "weight" || kind === "shed") && <div className="form-full"><Area label="Note (facoltative)" name="notes" value={notes} onChange={event => setNotes(event.target.value)} rows={3} /></div>}
        </>}
      </>}
  </Dialog>;
}
