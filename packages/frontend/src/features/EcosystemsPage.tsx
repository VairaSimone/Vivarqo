import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Alert, Button, LoadingState } from "../components/ui";

type Aquarium = { id: string; name: string; waterType: string; volumeLiters: string | number; readings?: Array<Record<string, unknown>>; _count?: { readings: number } };
type Aviary = { id: string; name: string; environment: string; capacity: number | null; _count?: { birds: number } };
type Bird = { id: string; name: string; species: string; identifier: string | null };
type Reading = { id: string; measuredAt: string; temperatureC: string | number | null; ph: string | number | null; ghDkh: string | number | null; khDkh: string | number | null; ammoniaMgL: string | number | null; nitriteMgL: string | number | null; nitrateMgL: string | number | null; salinityPpt: string | number | null; tdsPpm: number | null };
type Parameter = "temperatureC" | "ph" | "ghDkh" | "khDkh" | "nitrateMgL";
type ParameterRange = { id: string; parameter: Parameter; minValue: string | number | null; maxValue: string | number | null };
type AviaryMovement = { id: string; occurredAt: string; animal: { id: string; name: string; species: string }; fromAviary: { id: string; name: string } | null; toAviary: { id: string; name: string } | null; notes: string | null };
type AviaryNote = { id: string; title: string | null; body: string; occurredAt: string };

const inputDateTime = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

export function EcosystemsPage({ locale, path }: { locale: Locale; path: string }) {
  const italian = locale === "it";
  const aquariumMode = path.startsWith("/aquariums");
  const [aquariums, setAquariums] = useState<Aquarium[]>([]);
  const [aviaries, setAviaries] = useState<Aviary[]>([]);
  const [birds, setBirds] = useState<Bird[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [ranges, setRanges] = useState<ParameterRange[]>([]);
  const [rangeDraft, setRangeDraft] = useState<Record<Parameter, { min: string; max: string }>>({
    temperatureC: { min: "", max: "" }, ph: { min: "", max: "" }, ghDkh: { min: "", max: "" }, khDkh: { min: "", max: "" }, nitrateMgL: { min: "", max: "" },
  });
  const [movements, setMovements] = useState<AviaryMovement[]>([]);
  const [aviaryNotes, setAviaryNotes] = useState<AviaryNote[]>([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [chartParameter, setChartParameter] = useState<Parameter>("ph");
  const [selectedId, setSelectedId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedBirdIds, setSelectedBirdIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingSelected, setEditingSelected] = useState(false);
  const [editingReadingId, setEditingReadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [waterType, setWaterType] = useState("freshwater");
  const [volumeLiters, setVolumeLiters] = useState("100");
  const [environment, setEnvironment] = useState("indoor");
  const [capacity, setCapacity] = useState("");
  const [measuredAt, setMeasuredAt] = useState(inputDateTime);
  const [temperatureC, setTemperatureC] = useState("");
  const [ph, setPh] = useState("");
  const [ghDkh, setGhDkh] = useState("");
  const [khDkh, setKhDkh] = useState("");
  const [ammoniaMgL, setAmmoniaMgL] = useState("");
  const [nitriteMgL, setNitriteMgL] = useState("");
  const [nitrateMgL, setNitrateMgL] = useState("");
  const [salinityPpt, setSalinityPpt] = useState("");
  const [tdsPpm, setTdsPpm] = useState("");

  const selectedAquarium = useMemo(() => aquariums.find((item) => item.id === selectedId), [aquariums, selectedId]);
  const selectedAviary = useMemo(() => aviaries.find((item) => item.id === selectedId), [aviaries, selectedId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        if (aquariumMode) {
          const result = await api.get<{ aquariums: Aquarium[] }>(`/aquariums${showArchived ? "?archived=true" : ""}`);
          if (!active) return;
          setAquariums(result.aquariums);
          setSelectedId(showArchived ? "" : result.aquariums[0]?.id ?? "");
        } else {
          const [aviaryResult, birdResult] = await Promise.all([
            api.get<{ aviaries: Aviary[] }>(`/aviaries${showArchived ? "?archived=true" : ""}`),
            api.get<{ animals: Bird[] }>("/animals?category=birds&status=all&page=1&pageSize=100"),
          ]);
          if (!active) return;
          setAviaries(aviaryResult.aviaries);
          setBirds(birdResult.animals);
          setSelectedId(showArchived ? "" : aviaryResult.aviaries[0]?.id ?? "");
        }
      } catch (reason) {
        if (active) setError(reason instanceof ApiError ? reason.message : (italian ? "Impossibile caricare i dati." : "Unable to load data."));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [aquariumMode, italian, showArchived]);

  useEffect(() => {
    if (!aquariumMode || !selectedId) { setReadings([]); return; }
    let active = true;
    Promise.all([
      api.get<{ readings: Reading[] }>(`/aquariums/${encodeURIComponent(selectedId)}/readings?take=1000`),
      api.get<{ ranges: ParameterRange[] }>(`/aquariums/${encodeURIComponent(selectedId)}/ranges`),
    ]).then(([readingResult, rangeResult]) => {
      if (!active) return;
      setReadings(readingResult.readings);
      setRanges(rangeResult.ranges);
      setRangeDraft(() => {
        const next: Record<Parameter, { min: string; max: string }> = {
          temperatureC: { min: "", max: "" }, ph: { min: "", max: "" }, ghDkh: { min: "", max: "" }, khDkh: { min: "", max: "" }, nitrateMgL: { min: "", max: "" },
        };
        for (const range of rangeResult.ranges) next[range.parameter] = { min: range.minValue === null ? "" : String(range.minValue), max: range.maxValue === null ? "" : String(range.maxValue) };
        return next;
      });
    }).catch((reason: unknown) => { if (active) setError(reason instanceof ApiError ? reason.message : (italian ? "Impossibile caricare le misurazioni." : "Unable to load readings.")); });
    return () => { active = false; };
  }, [aquariumMode, selectedId, italian]);

  useEffect(() => {
    if (aquariumMode || !selectedId) { setSelectedBirdIds([]); return; }
    let active = true;
    api.get<{ birds: Bird[] }>(`/aviaries/${encodeURIComponent(selectedId)}/birds`)
      .then((result) => { if (active) setSelectedBirdIds(result.birds.map((bird) => bird.id)); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof ApiError ? reason.message : (italian ? "Impossibile caricare gli uccelli." : "Unable to load birds.")); });
    return () => { active = false; };
  }, [aquariumMode, selectedId, italian]);

  useEffect(() => {
    if (aquariumMode || !selectedId) { setMovements([]); setAviaryNotes([]); return; }
    let active = true;
    api.get<{ movements: AviaryMovement[]; notes: AviaryNote[] }>(`/aviaries/${encodeURIComponent(selectedId)}/history`)
      .then((result) => { if (active) { setMovements(result.movements); setAviaryNotes(result.notes); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof ApiError ? reason.message : (italian ? "Impossibile caricare lo storico della voliera." : "Unable to load aviary history.")); });
    return () => { active = false; };
  }, [aquariumMode, selectedId, italian]);

  async function submit(event: FormEvent<HTMLFormElement>, operation: () => Promise<void>) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try { await operation(); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : (italian ? "Operazione non riuscita." : "Operation failed.")); }
    finally { setSaving(false); }
  }

  async function createAquarium(event: FormEvent<HTMLFormElement>) {
    await submit(event, async () => {
      const payload = { name, waterType, volumeLiters: Number(volumeLiters) };
      if (editingSelected && selectedId) {
        const result = await api.patch<{ aquarium: Aquarium }>(`/aquariums/${encodeURIComponent(selectedId)}`, payload);
        setAquariums((current) => current.map((item) => item.id === selectedId ? result.aquarium : item).sort((a, b) => a.name.localeCompare(b.name)));
        setEditingSelected(false);
        setNotice(italian ? "Acquario aggiornato." : "Aquarium updated.");
      } else {
        const result = await api.post<{ aquarium: Aquarium }>("/aquariums", payload);
        setAquariums((current) => [...current, result.aquarium].sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedId(result.aquarium.id); setName(""); setNotice(italian ? "Acquario creato." : "Aquarium created.");
      }
    });
  }
  async function createAviary(event: FormEvent<HTMLFormElement>) {
    await submit(event, async () => {
      const payload = { name, environment, capacity: capacity ? Number(capacity) : null };
      if (editingSelected && selectedId) {
        const result = await api.patch<{ aviary: Aviary }>(`/aviaries/${encodeURIComponent(selectedId)}`, payload);
        setAviaries((current) => current.map((item) => item.id === selectedId ? result.aviary : item).sort((a, b) => a.name.localeCompare(b.name)));
        setEditingSelected(false);
        setNotice(italian ? "Voliera aggiornata." : "Aviary updated.");
      } else {
        const result = await api.post<{ aviary: Aviary }>("/aviaries", payload);
        setAviaries((current) => [...current, result.aviary].sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedId(result.aviary.id); setName(""); setCapacity(""); setNotice(italian ? "Voliera creata." : "Aviary created.");
      }
    });
  }
  async function createReading(event: FormEvent<HTMLFormElement>) {
    await submit(event, async () => {
      const payload = {
        measuredAt: new Date(measuredAt).toISOString(),
        temperatureC: temperatureC === "" ? null : Number(temperatureC),
        ph: ph === "" ? null : Number(ph),
        ghDkh: ghDkh === "" ? null : Number(ghDkh),
        khDkh: khDkh === "" ? null : Number(khDkh),
        ammoniaMgL: ammoniaMgL === "" ? null : Number(ammoniaMgL),
        nitriteMgL: nitriteMgL === "" ? null : Number(nitriteMgL),
        nitrateMgL: nitrateMgL === "" ? null : Number(nitrateMgL),
        salinityPpt: salinityPpt === "" ? null : Number(salinityPpt),
        tdsPpm: tdsPpm === "" ? null : Number(tdsPpm),
      };
      if (editingReadingId) {
        await api.patch(`/aquariums/${encodeURIComponent(selectedId)}/readings/${encodeURIComponent(editingReadingId)}`, payload);
      } else {
        await api.post(`/aquariums/${encodeURIComponent(selectedId)}/readings`, payload);
      }
      const result = await api.get<{ readings: Reading[] }>(`/aquariums/${encodeURIComponent(selectedId)}/readings?take=1000`);
      setReadings(result.readings);
      setEditingReadingId(null);
      setTemperatureC(""); setPh(""); setGhDkh(""); setKhDkh(""); setAmmoniaMgL(""); setNitriteMgL(""); setNitrateMgL(""); setSalinityPpt(""); setTdsPpm("");
      setNotice(italian ? (editingReadingId ? "Misurazione aggiornata." : "Parametri dell'acqua registrati.") : (editingReadingId ? "Reading updated." : "Water parameters recorded."));
    });
  }
  async function saveBirds(event: FormEvent<HTMLFormElement>) {
    await submit(event, async () => {
      await api.put(`/aviaries/${encodeURIComponent(selectedId)}/birds`, { animalIds: selectedBirdIds });
      const result = await api.get<{ aviaries: Aviary[] }>("/aviaries");
      setAviaries(result.aviaries);
      setNotice(italian ? "Assegnazione degli uccelli aggiornata." : "Bird assignment updated.");
    });
  }

  async function saveRanges(event: FormEvent<HTMLFormElement>) {
    await submit(event, async () => {
      const parameters: Parameter[] = ["temperatureC", "ph", "ghDkh", "khDkh", "nitrateMgL"];
      const payload = { ranges: parameters.filter((parameter) => rangeDraft[parameter].min !== "" || rangeDraft[parameter].max !== "").map((parameter) => ({
        parameter, minValue: rangeDraft[parameter].min === "" ? null : Number(rangeDraft[parameter].min),
        maxValue: rangeDraft[parameter].max === "" ? null : Number(rangeDraft[parameter].max),
      })) };
      const result = await api.put<{ ranges: ParameterRange[] }>(`/aquariums/${encodeURIComponent(selectedId)}/ranges`, payload);
      setRanges(result.ranges);
      setNotice(italian ? "Intervalli dei parametri aggiornati." : "Parameter ranges updated.");
    });
  }

  async function addAviaryNote(event: FormEvent<HTMLFormElement>) {
    await submit(event, async () => {
      const result = await api.post<{ note: AviaryNote }>(`/aviaries/${encodeURIComponent(selectedId)}/notes`, { title: noteTitle || null, body: noteBody });
      setAviaryNotes((current) => [result.note, ...current]);
      setNoteTitle(""); setNoteBody("");
      setNotice(italian ? "Nota aggiunta alla voliera." : "Aviary note added.");
    });
  }

  function editSelected() {
    setEditingSelected(true);
    if (aquariumMode && selectedAquarium) {
      setName(selectedAquarium.name);
      setWaterType(selectedAquarium.waterType);
      setVolumeLiters(String(selectedAquarium.volumeLiters));
    } else if (!aquariumMode && selectedAviary) {
      setName(selectedAviary.name);
      setEnvironment(selectedAviary.environment);
      setCapacity(selectedAviary.capacity === null ? "" : String(selectedAviary.capacity));
    }
  }

  async function archiveSelected() {
    const label = aquariumMode ? selectedAquarium?.name : selectedAviary?.name;
    if (!selectedId || !label || !window.confirm(italian ? `Archiviare "${label}"? I dati storici saranno conservati.` : `Archive "${label}"? Historical records will be retained.`)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await api.delete(`${aquariumMode ? "/aquariums" : "/aviaries"}/${encodeURIComponent(selectedId)}`);
      if (aquariumMode) setAquariums((current) => current.filter((item) => item.id !== selectedId));
      else setAviaries((current) => current.filter((item) => item.id !== selectedId));
      setSelectedId("");
      setEditingSelected(false);
      setReadings([]);
      setNotice(italian ? "Elemento archiviato." : "Item archived.");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : (italian ? "Archiviazione non riuscita." : "Unable to archive item."));
    } finally { setSaving(false); }
  }

  async function deleteReading(readingId: string) {
    if (!selectedId || !window.confirm(italian ? "Eliminare questa misurazione?" : "Delete this water reading?")) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await api.delete(`/aquariums/${encodeURIComponent(selectedId)}/readings/${encodeURIComponent(readingId)}`);
      setReadings((current) => current.filter((item) => item.id !== readingId));
      if (editingReadingId === readingId) setEditingReadingId(null);
      setNotice(italian ? "Misurazione eliminata." : "Reading deleted.");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : (italian ? "Eliminazione non riuscita." : "Unable to delete reading."));
    } finally { setSaving(false); }
  }

  if (loading) return <LoadingState />;
  return <section className="page ecosys-page">
    <header className="page-header"><div>
      <span className="eyebrow">{italian ? "MODULI SPECIALISTICI" : "SPECIALIST MODULES"}</span>
      <h1>{aquariumMode ? (italian ? "Acquari" : "Aquariums") : (italian ? "Voliere" : "Aviaries")}</h1>
      <p>{aquariumMode
        ? (italian ? "Gestisci vasche, volume, tipologia d'acqua e storico dei parametri misurati." : "Manage tanks, volume, water type and measured parameter history.")
        : (italian ? "Organizza gli spazi e assegna gli uccelli registrati al tuo account." : "Organise habitats and assign birds registered in your account.")}</p>
    </div></header>
    {error && <Alert tone="danger">{error}</Alert>}
    {notice && <Alert tone="success">{notice}</Alert>}
    <div className="ecosys-layout">
      <section className="panel ecosys-form-panel">
        <div className="panel-header"><div><h2>{editingSelected ? (italian ? "Modifica elemento" : "Edit item") : (aquariumMode ? (italian ? "Nuovo acquario" : "New aquarium") : (italian ? "Nuova voliera" : "New aviary"))}</h2></div></div>
        <form className="form-grid" onSubmit={aquariumMode ? createAquarium : createAviary}>
          <label className="field"><span className="field-label">{italian ? "Nome" : "Name"}</span><input className="control" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
          {aquariumMode ? <>
            <label className="field"><span className="field-label">{italian ? "Tipologia acqua" : "Water type"}</span><select className="control" value={waterType} onChange={(e) => setWaterType(e.target.value)}><option value="freshwater">{italian ? "Dolce" : "Freshwater"}</option><option value="saltwater">{italian ? "Marina" : "Saltwater"}</option><option value="brackish">{italian ? "Salmastra" : "Brackish"}</option></select></label>
            <label className="field"><span className="field-label">{italian ? "Volume (litri)" : "Volume (litres)"}</span><input className="control" type="number" min="0.01" step="0.01" required value={volumeLiters} onChange={(e) => setVolumeLiters(e.target.value)} /></label>
          </> : <>
            <label className="field"><span className="field-label">{italian ? "Ambiente" : "Environment"}</span><select className="control" value={environment} onChange={(e) => setEnvironment(e.target.value)}><option value="indoor">{italian ? "Interno" : "Indoor"}</option><option value="outdoor">{italian ? "Esterno" : "Outdoor"}</option><option value="mixed">{italian ? "Misto" : "Mixed"}</option></select></label>
            <label className="field"><span className="field-label">{italian ? "Capienza" : "Capacity"}</span><input className="control" type="number" min="1" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
          </>}
          <div className="ecosys-form-actions"><Button type="submit" disabled={saving}>{saving ? (italian ? "Salvataggio…" : "Saving…") : (editingSelected ? (italian ? "Salva modifiche" : "Save changes") : (italian ? "Crea" : "Create"))}</Button>
            {editingSelected && <Button type="button" variant="secondary" disabled={saving} onClick={() => { setEditingSelected(false); setName(""); setCapacity(""); }}>{italian ? "Annulla" : "Cancel"}</Button>}</div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>{showArchived ? (italian ? "Elementi archiviati" : "Archived items") : (aquariumMode ? (italian ? "Acquari registrati" : "Registered aquariums") : (italian ? "Voliere registrate" : "Registered aviaries"))}</h2></div><Button size="sm" variant="secondary" disabled={saving} onClick={() => setShowArchived((value) => !value)}>{showArchived ? (italian ? "Torna agli attivi" : "Show active") : (italian ? "Mostra archiviati" : "Show archived")}</Button></div>
        {aquariumMode ? aquariums.length === 0 ? <p className="ecosys-empty">{showArchived ? (italian ? "Nessun acquario archiviato." : "No archived aquariums.") : (italian ? "Non hai ancora creato acquari." : "No aquariums yet.")}</p> :
          <div className="ecosys-list">{aquariums.map((item) => <div className="ecosys-item" key={item.id}><strong>{item.name}</strong><span>{item.waterType} · {item.volumeLiters} L</span><small>{item._count?.readings ?? 0} {italian ? "misurazioni conservate" : "retained readings"}</small>{showArchived && <Button size="sm" disabled={saving} onClick={async () => { setSaving(true); setError(""); try { await api.post("/aquariums/" + encodeURIComponent(item.id) + "/restore", {}); setAquariums((current) => current.filter((entry) => entry.id !== item.id)); setNotice(italian ? "Acquario ripristinato." : "Aquarium restored."); } catch (reason) { setError(reason instanceof ApiError ? reason.message : (italian ? "Ripristino non riuscito." : "Unable to restore.")); } finally { setSaving(false); } }}>{italian ? "Ripristina" : "Restore"}</Button>}</div>)}</div>
          : aviaries.length === 0 ? <p className="ecosys-empty">{showArchived ? (italian ? "Nessuna voliera archiviata." : "No archived aviaries.") : (italian ? "Non hai ancora creato voliere." : "No aviaries yet.")}</p> :
          <div className="ecosys-list">{aviaries.map((item) => <div className="ecosys-item" key={item.id}><strong>{item.name}</strong><span>{item.environment}</span><small>{item._count?.birds ?? 0} {italian ? "uccelli associati" : "assigned birds"}</small>{showArchived && <Button size="sm" disabled={saving} onClick={async () => { setSaving(true); setError(""); try { await api.post("/aviaries/" + encodeURIComponent(item.id) + "/restore", {}); setAviaries((current) => current.filter((entry) => entry.id !== item.id)); setNotice(italian ? "Voliera ripristinata con le associazioni originali." : "Aviary restored with its original bird assignments."); } catch (reason) { setError(reason instanceof ApiError ? reason.message : (italian ? "Ripristino non riuscito." : "Unable to restore.")); } finally { setSaving(false); } }}>{italian ? "Ripristina" : "Restore"}</Button>}</div>)}</div>}
      </section>
    </div>
    {!showArchived && aquariumMode && selectedAquarium && <section className="panel ecosys-details">
      <div className="panel-header"><div><h2>{italian ? "Nuova misurazione" : "New water reading"}</h2><p>{selectedAquarium.name} · {selectedAquarium.volumeLiters} L</p></div><div className="inline-actions"><Button size="sm" variant="secondary" disabled={saving} onClick={editSelected}>{italian ? "Modifica acquario" : "Edit aquarium"}</Button><Button size="sm" variant="danger" disabled={saving} onClick={() => void archiveSelected()}>{italian ? "Archivia" : "Archive"}</Button></div></div>
      <form className="form-grid" onSubmit={createReading}>
        <label className="field"><span className="field-label">{italian ? "Data e ora" : "Date and time"}</span><input className="control" type="datetime-local" required value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} /></label>
        <label className="field"><span className="field-label">Temperatura (°C)</span><input className="control" type="number" min="-5" max="60" step="0.1" value={temperatureC} onChange={(e) => setTemperatureC(e.target.value)} /></label>
        <label className="field"><span className="field-label">pH</span><input className="control" type="number" min="0" max="14" step="0.01" value={ph} onChange={(e) => setPh(e.target.value)} /></label>
        <label className="field"><span className="field-label">GH (°dGH)</span><input className="control" type="number" min="0" max="100" step="0.1" value={ghDkh} onChange={(e) => setGhDkh(e.target.value)} /></label>
        <label className="field"><span className="field-label">KH (°dKH)</span><input className="control" type="number" min="0" max="100" step="0.1" value={khDkh} onChange={(e) => setKhDkh(e.target.value)} /></label>
        <label className="field"><span className="field-label">Ammoniaca (mg/L)</span><input className="control" type="number" min="0" step="0.0001" value={ammoniaMgL} onChange={(e) => setAmmoniaMgL(e.target.value)} /></label>
        <label className="field"><span className="field-label">Nitriti (mg/L)</span><input className="control" type="number" min="0" step="0.0001" value={nitriteMgL} onChange={(e) => setNitriteMgL(e.target.value)} /></label>
        <label className="field"><span className="field-label">Nitrati (mg/L)</span><input className="control" type="number" min="0" step="0.001" value={nitrateMgL} onChange={(e) => setNitrateMgL(e.target.value)} /></label>
        <label className="field"><span className="field-label">Salinità (ppt)</span><input className="control" type="number" min="0" max="100" step="0.001" value={salinityPpt} onChange={(e) => setSalinityPpt(e.target.value)} /></label>
        <label className="field"><span className="field-label">TDS (ppm)</span><input className="control" type="number" min="0" step="1" value={tdsPpm} onChange={(e) => setTdsPpm(e.target.value)} /></label>
        <div className="ecosys-form-actions"><Button type="submit" disabled={saving}>{saving ? (italian ? "Salvataggio…" : "Saving…") : (editingReadingId ? (italian ? "Aggiorna misurazione" : "Update reading") : (italian ? "Registra parametri" : "Save reading"))}</Button>
        {editingReadingId && <Button type="button" variant="secondary" disabled={saving} onClick={() => { setEditingReadingId(null); setTemperatureC(""); setPh(""); setGhDkh(""); setKhDkh(""); setAmmoniaMgL(""); setNitriteMgL(""); setNitrateMgL(""); setSalinityPpt(""); setTdsPpm(""); }}>{italian ? "Annulla modifica" : "Cancel edit"}</Button>}</div>
      </form>
      <section className="panel ecosys-monitoring">
        <div className="panel-header"><div><h3>{italian ? "Andamento dei parametri" : "Parameter trends"}</h3><p>{italian ? "Confronto cronologico delle ultime 1.000 misurazioni." : "Timeline comparison of the latest 1,000 readings."}</p></div><div className="inline-actions"><select className="control" value={chartParameter} onChange={(event) => setChartParameter(event.target.value as Parameter)}><option value="temperatureC">Temperatura °C</option><option value="ph">pH</option><option value="ghDkh">GH</option><option value="khDkh">KH</option><option value="nitrateMgL">Nitrati mg/L</option></select><Button size="sm" variant="secondary" onClick={() => void api.download(`/aquariums/${encodeURIComponent(selectedId)}/export.csv`, `acquario-${selectedAquarium.name}-misurazioni.csv`)}>{italian ? "Esporta CSV" : "Export CSV"}</Button></div></div>
        <TrendChart readings={readings} parameter={chartParameter} locale={locale} />
        {readings.length >= 2 && <p className="muted-note">{italian ? "Ultime due rilevazioni" : "Latest two readings"}: {String(readings[1]?.[chartParameter] ?? "—")} → {String(readings[0]?.[chartParameter] ?? "—")}</p>}
      </section>
      <section className="panel ecosys-ranges">
        <div className="panel-header"><div><h3>{italian ? "Intervalli di riferimento" : "Reference ranges"}</h3><p>{italian ? "Imposta limiti specifici per questo acquario." : "Set limits specific to this aquarium."}</p></div></div>
        <form className="form-grid" onSubmit={saveRanges}>
          {([{key:"temperatureC",label:"Temperatura (°C)"},{key:"ph",label:"pH"},{key:"ghDkh",label:"GH"},{key:"khDkh",label:"KH"},{key:"nitrateMgL",label:"Nitrati (mg/L)"}] as const).map(({key,label}) => <div className="field" key={key}><span className="field-label">{label}</span><div className="inline-actions"><input className="control" aria-label={label + " minimo"} type="number" step="any" placeholder="Min" value={rangeDraft[key].min} onChange={(event) => setRangeDraft((current) => ({...current,[key]:{...current[key],min:event.target.value}}))}/><input className="control" aria-label={label + " massimo"} type="number" step="any" placeholder="Max" value={rangeDraft[key].max} onChange={(event) => setRangeDraft((current) => ({...current,[key]:{...current[key],max:event.target.value}}))}/></div></div>)}
          <Button type="submit" disabled={saving}>{italian ? "Salva intervalli" : "Save ranges"}</Button>
        </form>
      </section>
      <div className="ecosys-history"><h3>{italian ? "Storico recente" : "Recent history"}</h3>
        {readings.length === 0 ? <p className="ecosys-empty">{italian ? "Nessuna misurazione registrata." : "No readings recorded."}</p> :
          readings.map((reading) => <div className="ecosys-reading" key={reading.id}><strong>{new Date(reading.measuredAt).toLocaleString(italian ? "it-IT" : "en-GB")}</strong><span>{reading.temperatureC ?? "—"} °C · pH {reading.ph ?? "—"} · GH {reading.ghDkh ?? "—"} · KH {reading.khDkh ?? "—"} · NH₃ {reading.ammoniaMgL ?? "—"} · NO₂ {reading.nitriteMgL ?? "—"} · NO₃ {reading.nitrateMgL ?? "—"} · Salinità {reading.salinityPpt ?? "—"} ppt · TDS {reading.tdsPpm ?? "—"}</span>
          {ranges.filter((range) => { const value = Number(reading[range.parameter]); return reading[range.parameter] !== null && ((range.minValue !== null && value < Number(range.minValue)) || (range.maxValue !== null && value > Number(range.maxValue))); }).map((range) => <strong className="status-danger" key={range.parameter}>{range.parameter}: {italian ? "fuori intervallo" : "out of range"}</strong>)}<div className="inline-actions"><Button size="sm" variant="secondary" disabled={saving} onClick={() => { setEditingReadingId(reading.id); const date = new Date(reading.measuredAt); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); setMeasuredAt(date.toISOString().slice(0,16)); setTemperatureC(reading.temperatureC === null ? "" : String(reading.temperatureC)); setPh(reading.ph === null ? "" : String(reading.ph)); setGhDkh(reading.ghDkh === null ? "" : String(reading.ghDkh)); setKhDkh(reading.khDkh === null ? "" : String(reading.khDkh)); setAmmoniaMgL(reading.ammoniaMgL === null ? "" : String(reading.ammoniaMgL)); setNitriteMgL(reading.nitriteMgL === null ? "" : String(reading.nitriteMgL)); setNitrateMgL(reading.nitrateMgL === null ? "" : String(reading.nitrateMgL)); setSalinityPpt(reading.salinityPpt === null ? "" : String(reading.salinityPpt)); setTdsPpm(reading.tdsPpm === null ? "" : String(reading.tdsPpm)); }}>{italian ? "Modifica" : "Edit"}</Button><Button size="sm" variant="danger" disabled={saving} onClick={() => void deleteReading(reading.id)}>{italian ? "Elimina" : "Delete"}</Button></div></div>) }
      </div>
    </section>}
    {!showArchived && !aquariumMode && selectedAviary && <section className="panel ecosys-details">
      <div className="panel-header"><div><h2>{italian ? "Uccelli nella voliera" : "Birds in this aviary"}</h2><p>{selectedAviary.name} · {selectedAviary._count?.birds ?? 0}/{selectedAviary.capacity ?? "∞"} {italian ? "posti occupati" : "occupied"} · {selectedAviary.capacity === null ? (italian ? "capienza illimitata" : "unlimited capacity") : (italian ? "posti liberi: " : "available: ") + Math.max(0, selectedAviary.capacity - (selectedAviary._count?.birds ?? 0))}</p></div><div className="inline-actions"><Button size="sm" variant="secondary" disabled={saving} onClick={editSelected}>{italian ? "Modifica voliera" : "Edit aviary"}</Button><Button size="sm" variant="danger" disabled={saving} onClick={() => void archiveSelected()}>{italian ? "Archivia" : "Archive"}</Button></div></div>
      {birds.length === 0 ? <p className="ecosys-empty">{italian ? "Prima registra gli uccelli nella sezione Animali." : "Add bird records in the Animals section first."}</p> :
        <form onSubmit={saveBirds} className="ecosys-bird-form">
          <div className="ecosys-bird-picker">{birds.map((bird) => <label key={bird.id} className="checkbox-field"><input type="checkbox" checked={selectedBirdIds.includes(bird.id)} onChange={(event) => setSelectedBirdIds((current) => event.target.checked ? [...current, bird.id] : current.filter((id) => id !== bird.id))} /><span><strong>{bird.name}</strong><small>{bird.species}</small></span></label>)}</div>
          <Button type="submit" disabled={saving}>{italian ? "Salva assegnazioni" : "Save assignments"}</Button>
        </form>}
      <div className="ecosys-history"><h3>{italian ? "Registro spostamenti e assegnazioni" : "Movement and assignment history"}</h3>
        {movements.length === 0 ? <p className="ecosys-empty">{italian ? "Nessuno spostamento registrato." : "No movements recorded."}</p> : movements.map((movement) => <div className="ecosys-reading" key={movement.id}><strong>{movement.animal.name} · {movement.fromAviary?.name ?? (italian ? "Esterno" : "Outside")} → {movement.toAviary?.name ?? (italian ? "Uscita" : "Departed")}</strong><span>{new Date(movement.occurredAt).toLocaleString(italian ? "it-IT" : "en-GB")}</span></div>)}
      </div>
      <form className="form-grid" onSubmit={addAviaryNote}><h3>{italian ? "Nota o intervento sulla voliera" : "Aviary note or intervention"}</h3><label className="field"><span className="field-label">{italian ? "Titolo" : "Title"}</span><input className="control" maxLength={160} value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} /></label><label className="field"><span className="field-label">{italian ? "Descrizione" : "Description"}</span><textarea className="control" required maxLength={10000} value={noteBody} onChange={(event) => setNoteBody(event.target.value)} /></label><Button type="submit" disabled={saving}>{italian ? "Aggiungi nota" : "Add note"}</Button></form>
      <div className="ecosys-history"><h3>{italian ? "Note e interventi" : "Notes and interventions"}</h3>{aviaryNotes.map((note) => <div className="ecosys-reading" key={note.id}><strong>{note.title || (italian ? "Nota" : "Note")}</strong><span>{new Date(note.occurredAt).toLocaleString(italian ? "it-IT" : "en-GB")}</span><p>{note.body}</p></div>)}</div>
    </section>}
  </section>;
}


function TrendChart({ readings, parameter, locale }: { readings: Reading[]; parameter: Parameter; locale: Locale }) {
  const values = [...readings].reverse().map((reading) => ({ date: reading.measuredAt, value: reading[parameter] === null ? null : Number(reading[parameter]) })).filter((item): item is { date: string; value: number } => item.value !== null && Number.isFinite(item.value));
  if (values.length < 2) return <p className="ecosys-empty">{locale === "it" ? "Servono almeno due misurazioni del parametro selezionato." : "At least two readings are needed for this parameter."}</p>;
  const min = Math.min(...values.map((item) => item.value));
  const max = Math.max(...values.map((item) => item.value));
  const span = max - min || 1;
  const points = values.map((item, index) => ({ x: 8 + index * 584 / (values.length - 1), y: 112 - (item.value - min) / span * 96 }));
  const path = points.map((point, index) => (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1)).join(" ");
  return <div className="ecosys-trend"><svg viewBox="0 0 600 132" role="img" aria-label={(locale === "it" ? "Grafico andamento " : "Trend chart ") + parameter}><path d="M8 16H592 M8 64H592 M8 112H592" stroke="currentColor" opacity=".15" fill="none"/><path d={path} stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>{points.map((point,index)=><circle key={index} cx={point.x} cy={point.y} r="3" fill="currentColor"/>)}</svg><div className="inline-actions"><span>Min: {min}</span><span>Max: {max}</span><span>{values.length} {locale === "it" ? "punti" : "points"}</span></div><small>{new Date(values[0]!.date).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB")} → {new Date(values[values.length-1]!.date).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB")}</small></div>;
}
