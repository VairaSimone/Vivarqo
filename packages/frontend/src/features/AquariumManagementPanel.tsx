import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Alert, Button } from "../components/ui";

type Tank = { id: string; name: string; volumeLiters: string | number };
type RecordRow = Record<string, unknown> & { id: string };
type Data = {
  waterChanges: RecordRow[]; filterMaintenances: RecordRow[]; productDosages: RecordRow[];
  populations: RecordRow[]; movements: RecordRow[]; quarantines: RecordRow[];
  treatments: RecordRow[]; reproductions: RecordRow[]; compatibilityRules: RecordRow[];
};
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,16); };
const iso = (v: string) => new Date(v).toISOString();
const dateLabel = (v: unknown, it: boolean) => typeof v === "string" ? new Date(v).toLocaleString(it ? "it-IT" : "en-GB") : "—";

export function AquariumManagementPanel({ aquarium, aquariums, locale }: { aquarium: Tank; aquariums: Tank[]; locale: Locale }) {
  const it = locale === "it";
  const [data, setData] = useState<Data>({ waterChanges: [], filterMaintenances: [], productDosages: [], populations: [], movements: [], quarantines: [], treatments: [], reproductions: [], compatibilityRules: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [section, setSection] = useState("population");
  const [water, setWater] = useState({ occurredAt: nowLocal(), volumeLiters: "", percentage: "25", waterSource: "", conditioner: "" });
  const [filter, setFilter] = useState({ occurredAt: nowLocal(), filterName: "", action: "cleaning", material: "", materialChanged: false, nextDueAt: "" });
  const [dose, setDose] = useState({ occurredAt: nowLocal(), productName: "", productType: "fertilizer", doseAmount: "", doseUnit: "ml", targetVolumeL: String(aquarium.volumeLiters) });
  const [population, setPopulation] = useState({ movementType: "introduction", speciesKey: "", commonName: "", scientificName: "", quantity: "1", occurredAt: nowLocal(), toAquariumId: "", reason: "", notes: "" });
  const [quarantine, setQuarantine] = useState({ speciesKey: "", commonName: "", quantity: "1", startedAt: nowLocal(), source: "", observations: "" });
  const [treatment, setTreatment] = useState({ startedAt: nowLocal(), treatmentType: "medication", productName: "", activeIngredient: "", doseAmount: "", doseUnit: "ml", targetSpecies: "", instructions: "" });
  const [reproduction, setReproduction] = useState({ speciesKey: "", commonName: "", startedAt: nowLocal(), spawnedAt: "", hatchedAt: "", eggsCount: "", hatchedCount: "", survivingCount: "", notes: "" });
  const [compatibility, setCompatibility] = useState({ speciesAKey: "", speciesBKey: "", compatibility: "caution", notes: "" });
  const [calculatedLiters, setCalculatedLiters] = useState<number | null>(null);
  const destinations = useMemo(() => aquariums.filter(item => item.id !== aquarium.id), [aquariums, aquarium.id]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await api.get<Data>(`/aquariums/${encodeURIComponent(aquarium.id)}/management`)); }
    catch (e) { setError(e instanceof ApiError ? e.message : (it ? "Impossibile caricare la gestione acquario." : "Could not load aquarium management.")); }
    finally { setLoading(false); }
  }, [aquarium.id, it]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const percentage = Number(water.percentage);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) { setCalculatedLiters(null); return; }
    let active = true;
    api.get<{ waterToChangeLiters: number }>(`/aquariums/${encodeURIComponent(aquarium.id)}/water-change-calculator?percentage=${percentage}`)
      .then(result => { if (active) setCalculatedLiters(result.waterToChangeLiters); })
      .catch(() => { if (active) setCalculatedLiters(null); });
    return () => { active = false; };
  }, [aquarium.id, water.percentage]);

  async function submit(event: FormEvent, action: () => Promise<void>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try { await action(); await load(); setNotice(it ? "Registrazione salvata." : "Record saved."); }
    catch (e) { setError(e instanceof ApiError ? e.message : (it ? "Salvataggio non riuscito." : "Could not save record.")); }
    finally { setSaving(false); }
  }
  const path = `/aquariums/${encodeURIComponent(aquarium.id)}`;
  const field = (label: string, value: string, onChange: (v: string) => void, type = "text", required = false, extra: Record<string, string> = {}) =>
    <label className="field"><span className="field-label">{label}</span><input className="control" type={type} required={required} value={value} onChange={e => onChange(e.target.value)} {...extra} /></label>;
  const select = (label: string, value: string, onChange: (v: string) => void, options: Array<[string,string]>) =>
    <label className="field"><span className="field-label">{label}</span><select className="control" value={value} onChange={e => onChange(e.target.value)}>{options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  const textarea = (label: string, value: string, onChange: (v: string) => void) =>
    <label className="field"><span className="field-label">{label}</span><textarea className="control" rows={2} value={value} onChange={e => onChange(e.target.value)} /></label>;
  const nav = [
    ["population", it ? "Popolazione" : "Population"], ["water", it ? "Cambi d'acqua" : "Water changes"],
    ["filters", it ? "Filtri" : "Filters"], ["dosing", it ? "Prodotti" : "Dosing"],
    ["quarantine", it ? "Quarantena" : "Quarantine"], ["treatments", it ? "Trattamenti" : "Treatments"],
    ["breeding", it ? "Riproduzione" : "Breeding"], ["compatibility", it ? "Compatibilità" : "Compatibility"],
  ];
  return <section className="panel ecosys-details">
    <div className="panel-header"><div><h2>{it ? "Gestione acquario" : "Aquarium management"}</h2><p>{aquarium.name} · {aquarium.volumeLiters} L</p></div></div>
    <div className="inline-actions" role="tablist">{nav.map(([key,label]) => <Button key={key} size="sm" variant={section === key ? "primary" : "secondary"} onClick={() => setSection(key)}>{label}</Button>)}</div>
    {error && <Alert tone="danger">{error}</Alert>}{notice && <Alert tone="success">{notice}</Alert>}
    {loading ? <p>{it ? "Caricamento…" : "Loading…"}</p> : <>
      {section === "population" && <>
        <h3>{it ? "Popolazione attuale" : "Current population"}</h3>
        {data.populations.length === 0 ? <p className="ecosys-empty">{it ? "Nessuna specie registrata. Registra un'introduzione per iniziare." : "No species recorded. Log an introduction to start."}</p> :
          <div className="ecosys-history">{data.populations.map(row => <div className="ecosys-reading" key={row.id}><strong>{String(row.commonName || row.speciesKey)} · {String(row.quantity)}</strong><span>{String(row.scientificName || row.speciesKey)}</span></div>)}</div>}
        <h3>{it ? "Registra ingresso, uscita, mortalità o trasferimento" : "Log introduction, removal, mortality or transfer"}</h3>
        <form className="form-grid" onSubmit={e => void submit(e, async () => {
          await api.post(path + "/population-movements", {
            ...population, quantity: Number(population.quantity), occurredAt: iso(population.occurredAt),
            fromAquariumId: ["removal","mortality","transfer"].includes(population.movementType) ? aquarium.id : null,
            toAquariumId: ["introduction","transfer"].includes(population.movementType) ? (population.movementType === "introduction" ? aquarium.id : population.toAquariumId) : null,
            reason: population.reason || null, notes: population.notes || null,
          });
        })}>
          {select(it ? "Operazione" : "Movement", population.movementType, v => setPopulation(p => ({...p,movementType:v})), [["introduction",it?"Introduzione":"Introduction"],["removal",it?"Uscita":"Removal"],["mortality",it?"Mortalità":"Mortality"],["transfer",it?"Trasferimento":"Transfer"]])}
          {field(it?"Chiave specie (nome scientifico consigliato)":"Species key (scientific name recommended)",population.speciesKey,v=>setPopulation(p=>({...p,speciesKey:v})),"text",true)}
          {field(it?"Nome comune":"Common name",population.commonName,v=>setPopulation(p=>({...p,commonName:v} ))}
          {field(it?"Nome scientifico":"Scientific name",population.scientificName,v=>setPopulation(p=>({...p,scientificName:v} ))}
          {field(it?"Quantità":"Quantity",population.quantity,v=>setPopulation(p=>({...p,quantity:v})),"number",true,{min:"1",step:"1"})}
          {field(it?"Data e ora":"Date and time",population.occurredAt,v=>setPopulation(p=>({...p,occurredAt:v})),"datetime-local",true)}
          {population.movementType === "transfer" && select(it?"Acquario di destinazione":"Destination aquarium",population.toAquariumId,v=>setPopulation(p=>({...p,toAquariumId:v})),destinations.map(t=>[t.id,t.name]))}
          {field(it?"Motivo":"Reason",population.reason,v=>setPopulation(p=>({...p,reason:v})))}
          {textarea(it?"Note":"Notes",population.notes,v=>setPopulation(p=>({...p,notes:v})))}
          <Button type="submit" disabled={saving || (population.movementType === "transfer" && !population.toAquariumId)}>{it?"Registra movimento":"Save movement"}</Button>
        </form>
        <h3>{it ? "Storico movimenti" : "Movement history"}</h3>
        <div className="ecosys-history">{data.movements.map(row => <div className="ecosys-reading" key={row.id}><strong>{String(row.movementType)} · {String(row.commonName || row.speciesKey)} × {String(row.quantity)}</strong><span>{dateLabel(row.occurredAt,it)} · {String((row.fromAquarium as {name?:string}|null)?.name || (it?"Esterno":"Outside"))} → {String((row.toAquarium as {name?:string}|null)?.name || (it?"Uscita":"Out"))}</span>{row.reason && <small>{String(row.reason)}</small>}</div>)}</div>
      </>}
      {section === "water" && <>
        <h3>{it?"Registro cambi d'acqua":"Water change log"}</h3>
        <form className="form-grid" onSubmit={e=>void submit(e,async()=>{
          await api.post(path+"/water-changes",{occurredAt:iso(water.occurredAt),volumeLiters:Number(water.volumeLiters || calculatedLiters),percentage:water.percentage?Number(water.percentage):null,waterSource:water.waterSource||null,conditioner:water.conditioner||null});
        })}>
          {field(it?"Data e ora":"Date and time",water.occurredAt,v=>setWater(p=>({...p,occurredAt:v})),"datetime-local",true)}
          {field(it?"Percentuale cambio (%)":"Change percentage (%)",water.percentage,v=>setWater(p=>({...p,percentage:v})),"number",true,{min:"0.1",max:"100",step:"0.1"})}
          <div className="field"><span className="field-label">{it?"Volume calcolato":"Calculated volume"}</span><strong>{calculatedLiters ?? "—"} L</strong></div>
          {field(it?"Litri effettivi":"Actual litres",water.volumeLiters,v=>setWater(p=>({...p,volumeLiters:v})),"number",false,{min:"0.01",step:"0.01"})}
          {field(it?"Fonte acqua":"Water source",water.waterSource,v=>setWater(p=>({...p,waterSource:v})))}
          {field(it?"Biocondizionatore":"Water conditioner",water.conditioner,v=>setWater(p=>({...p,conditioner:v})))}
          <Button type="submit" disabled={saving || (!water.volumeLiters && calculatedLiters === null)}>{it?"Registra cambio":"Save water change"}</Button>
        </form>
        <div className="ecosys-history">{data.waterChanges.map(row=><div className="ecosys-reading" key={row.id}><strong>{String(row.volumeLiters)} L · {String(row.percentage ?? "—")}%</strong><span>{dateLabel(row.occurredAt,it)} · {String(row.waterSource||"")}</span></div>)}</div>
      </>}
      {section === "filters" && <>
        <h3>{it?"Manutenzione filtri e materiali":"Filter and media maintenance"}</h3>
        <form className="form-grid" onSubmit={e=>void submit(e,async()=>{await api.post(path+"/filter-maintenance",{occurredAt:iso(filter.occurredAt),filterName:filter.filterName,action:filter.action,material:filter.material||null,materialChanged:filter.materialChanged,nextDueAt:filter.nextDueAt?iso(filter.nextDueAt):null});})}>
          {field(it?"Data e ora":"Date and time",filter.occurredAt,v=>setFilter(p=>({...p,occurredAt:v})),"datetime-local",true)}
          {field(it?"Filtro":"Filter",filter.filterName,v=>setFilter(p=>({...p,filterName:v})),"text",true)}
          {select(it?"Intervento":"Action",filter.action,v=>setFilter(p=>({...p,action:v})),[["cleaning",it?"Pulizia":"Cleaning"],["replacement",it?"Sostituzione":"Replacement"],["inspection",it?"Ispezione":"Inspection"],["other",it?"Altro":"Other"]])}
          {field(it?"Materiale filtrante":"Filter media",filter.material,v=>setFilter(p=>({...p,material:v})))}
          {field(it?"Prossima manutenzione":"Next maintenance",filter.nextDueAt,v=>setFilter(p=>({...p,nextDueAt:v})),"datetime-local")}
          <label className="checkbox-field"><input type="checkbox" checked={filter.materialChanged} onChange={e=>setFilter(p=>({...p,materialChanged:e.target.checked}))}/><span>{it?"Materiale filtrante sostituito":"Filter media replaced"}</span></label>
          <Button type="submit" disabled={saving}>{it?"Registra manutenzione":"Save maintenance"}</Button>
        </form>
        <div className="ecosys-history">{data.filterMaintenances.map(row=><div className="ecosys-reading" key={row.id}><strong>{String(row.filterName)} · {String(row.action)}</strong><span>{dateLabel(row.occurredAt,it)} · {String(row.material||"—")} · {row.materialChanged? (it?"sostituito":"replaced"):""}</span>{row.nextDueAt && <small>{it?"Prossima manutenzione":"Next due"}: {dateLabel(row.nextDueAt,it)}</small>}</div>)}</div>
      </>}
      {section === "dosing" && <>
        <h3>{it?"Dosaggio fertilizzanti e prodotti":"Fertilizer and product dosing"}</h3>
        <form className="form-grid" onSubmit={e=>void submit(e,async()=>{await api.post(path+"/product-dosages",{occurredAt:iso(dose.occurredAt),productName:dose.productName,productType:dose.productType,doseAmount:Number(dose.doseAmount),doseUnit:dose.doseUnit,targetVolumeL:dose.targetVolumeL?Number(dose.targetVolumeL):null});})}>
          {field(it?"Data e ora":"Date and time",dose.occurredAt,v=>setDose(p=>({...p,occurredAt:v})),"datetime-local",true)}
          {field(it?"Prodotto":"Product",dose.productName,v=>setDose(p=>({...p,productName:v})),"text",true)}
          {select(it?"Categoria":"Type",dose.productType,v=>setDose(p=>({...p,productType:v})),[["fertilizer",it?"Fertilizzante":"Fertilizer"],["conditioner",it?"Biocondizionatore":"Conditioner"],["mineral",it?"Minerali":"Minerals"],["bacteria",it?"Batteri":"Bacteria"],["other",it?"Altro":"Other"]])}
          {field(it?"Quantità":"Amount",dose.doseAmount,v=>setDose(p=>({...p,doseAmount:v})),"number",true,{min:"0.001",step:"any"})}
          {field(it?"Unità (ml, g, gocce…)":"Unit (ml, g, drops…)",dose.doseUnit,v=>setDose(p=>({...p,doseUnit:v})),"text",true)}
          {field(it?"Volume trattato (L)":"Treated volume (L)",dose.targetVolumeL,v=>setDose(p=>({...p,targetVolumeL:v})),"number",false,{min:"0.01",step:"0.01"})}
          <Button type="submit" disabled={saving}>{it?"Registra dosaggio":"Save dosage"}</Button>
        </form>
        <div className="ecosys-history">{data.productDosages.map(row=><div className="ecosys-reading" key={row.id}><strong>{String(row.productName)} · {String(row.doseAmount)} {String(row.doseUnit)}</strong><span>{dateLabel(row.occurredAt,it)} · {String(row.productType)} · {String(row.targetVolumeL||"—")} L</span></div>)}</div>
      </>}
      {section === "quarantine" && <>
        <h3>{it?"Quarantena nuovi pesci":"New fish quarantine"}</h3>
        <form className="form-grid" onSubmit={e=>void submit(e,async()=>{await api.post(path+"/quarantines",{...quarantine,quantity:Number(quarantine.quantity),startedAt:iso(quarantine.startedAt),source:quarantine.source||null,commonName:quarantine.commonName||null,observations:quarantine.observations||null});})}>
          {field(it?"Specie":"Species",quarantine.speciesKey,v=>setQuarantine(p=>({...p,speciesKey:v})),"text",true)}
          {field(it?"Nome comune":"Common name",quarantine.commonName,v=>setQuarantine(p=>({...p,commonName:v})))}
          {field(it?"Numero esemplari":"Number of fish",quarantine.quantity,v=>setQuarantine(p=>({...p,quantity:v})),"number",true,{min:"1",step:"1"})}
          {field(it?"Data ingresso":"Start date",quarantine.startedAt,v=>setQuarantine(p=>({...p,startedAt:v})),"datetime-local",true)}
          {field(it?"Provenienza":"Source",quarantine.source,v=>setQuarantine(p=>({...p,source:v})))}
          {textarea(it?"Osservazioni":"Observations",quarantine.observations,v=>setQuarantine(p=>({...p,observations:v})))}
          <Button type="submit" disabled={saving}>{it?"Registra quarantena":"Save quarantine"}</Button>
        </form>
        <div className="ecosys-history">{data.quarantines.map(row=><div className="ecosys-reading" key={row.id}><strong>{String(row.commonName||row.speciesKey)} × {String(row.quantity)} · {String(row.status)}</strong><span>{dateLabel(row.startedAt,it)} · {String(row.source||"—")}</span></div>)}</div>
      </>}
      {section === "treatments" && <>
        <h3>{it?"Trattamenti e medicinali":"Treatments and medication"}</h3>
        <form className="form-grid" onSubmit={e=>void submit(e,async()=>{await api.post(path+"/treatments",{...treatment,startedAt:iso(treatment.startedAt),endedAt:null,doseAmount:treatment.doseAmount?Number(treatment.doseAmount):null,activeIngredient:treatment.activeIngredient||null,doseUnit:treatment.doseUnit||null,targetSpecies:treatment.targetSpecies||null,instructions:treatment.instructions||null});})}>
          {field(it?"Inizio trattamento":"Treatment start",treatment.startedAt,v=>setTreatment(p=>({...p,startedAt:v})),"datetime-local",true)}
          {select(it?"Tipo":"Type",treatment.treatmentType,v=>setTreatment(p=>({...p,treatmentType:v})),[["medication",it?"Medicinale":"Medication"],["antiparasitic",it?"Antiparassitario":"Antiparasitic"],["other",it?"Altro":"Other"]])}
          {field(it?"Prodotto":"Product",treatment.productName,v=>setTreatment(p=>({...p,productName:v})),"text",true)}
          {field(it?"Principio attivo":"Active ingredient",treatment.activeIngredient,v=>setTreatment(p=>({...p,activeIngredient:v})))}
          {field(it?"Dose":"Dose",treatment.doseAmount,v=>setTreatment(p=>({...p,doseAmount:v})),"number",false,{min:"0.001",step:"any"})}
          {field(it?"Unità":"Unit",treatment.doseUnit,v=>setTreatment(p=>({...p,doseUnit:v})))}
          {field(it?"Specie interessata":"Target species",treatment.targetSpecies,v=>setTreatment(p=>({...p,targetSpecies:v})))}
          {textarea(it?"Istruzioni":"Instructions",treatment.instructions,v=>setTreatment(p=>({...p,instructions:v})))}
          <Button type="submit" disabled={saving}>{it?"Registra trattamento":"Save treatment"}</Button>
        </form>
        <div className="ecosys-history">{data.treatments.map(row=><div className="ecosys-reading" key={row.id}><strong>{String(row.productName)} · {String(row.treatmentType)}</strong><span>{dateLabel(row.startedAt,it)} · {String(row.activeIngredient||"—")} · {String(row.doseAmount||"")} {String(row.doseUnit||"")}</span></div>)}</div>
      </>}
      {section === "breeding" && <>
        <h3>{it?"Riproduzione, deposizione e schiuse":"Breeding, spawning and hatching"}</h3>
        <form className="form-grid" onSubmit={e=>void submit(e,async()=>{await api.post(path+"/reproductions",{...reproduction,startedAt:iso(reproduction.startedAt),spawnedAt:reproduction.spawnedAt?iso(reproduction.spawnedAt):null,hatchedAt:reproduction.hatchedAt?iso(reproduction.hatchedAt):null,eggsCount:reproduction.eggsCount===""?null:Number(reproduction.eggsCount),hatchedCount:reproduction.hatchedCount===""?null:Number(reproduction.hatchedCount),survivingCount:reproduction.survivingCount===""?null:Number(reproduction.survivingCount),commonName:reproduction.commonName||null,notes:reproduction.notes||null});})}>
          {field(it?"Specie":"Species",reproduction.speciesKey,v=>setReproduction(p=>({...p,speciesKey:v})),"text",true)}
          {field(it?"Nome comune":"Common name",reproduction.commonName,v=>setReproduction(p=>({...p,commonName:v})))}
          {field(it?"Inizio ciclo":"Cycle start",reproduction.startedAt,v=>setReproduction(p=>({...p,startedAt:v})),"datetime-local",true)}
          {field(it?"Deposizione":"Spawning",reproduction.spawnedAt,v=>setReproduction(p=>({...p,spawnedAt:v})),"datetime-local")}
          {field(it?"Schiusa":"Hatching",reproduction.hatchedAt,v=>setReproduction(p=>({...p,hatchedAt:v})),"datetime-local")}
          {field(it?"Uova":"Eggs",reproduction.eggsCount,v=>setReproduction(p=>({...p,eggsCount:v})),"number",false,{min:"0",step:"1"})}
          {field(it?"Nati":"Hatched",reproduction.hatchedCount,v=>setReproduction(p=>({...p,hatchedCount:v})),"number",false,{min:"0",step:"1"})}
          {field(it?"Sopravvissuti":"Surviving",reproduction.survivingCount,v=>setReproduction(p=>({...p,survivingCount:v})),"number",false,{min:"0",step:"1"})}
          <Button type="submit" disabled={saving}>{it?"Registra riproduzione":"Save breeding record"}</Button>
        </form>
        <div className="ecosys-history">{data.reproductions.map(row=><div className="ecosys-reading" key={row.id}><strong>{String(row.commonName||row.speciesKey)}</strong><span>{dateLabel(row.startedAt,it)} · {it?"Uova":"Eggs"}: {String(row.eggsCount??"—")} · {it?"Nati":"Hatched"}: {String(row.hatchedCount??"—")} · {it?"Sopravvissuti":"Surviving"}: {String(row.survivingCount??"—")}</span></div>)}</div>
      </>}
      {section === "compatibility" && <>
        <h3>{it?"Matrice di compatibilità tra specie":"Species compatibility matrix"}</h3>
        <p className="muted-note">{it?"Le regole sono personalizzate per il tuo account: non esiste una compatibilità universale, perché contano dimensioni, comportamento, valori dell'acqua e allestimento. Inserisci valutazioni basate su fonti affidabili o sulla tua esperienza.":"Rules are account-specific: compatibility is not universal and depends on size, behaviour, water parameters and setup. Enter assessments grounded in reliable sources or your own experience."}</p>
        <form className="form-grid" onSubmit={e=>void submit(e,async()=>{await api.put(path+"/compatibility-rules",{...compatibility,notes:compatibility.notes||null});})}>
          {field(it?"Specie A":"Species A",compatibility.speciesAKey,v=>setCompatibility(p=>({...p,speciesAKey:v})),"text",true)}
          {field(it?"Specie B":"Species B",compatibility.speciesBKey,v=>setCompatibility(p=>({...p,speciesBKey:v})),"text",true)}
          {select(it?"Valutazione":"Assessment",compatibility.compatibility,v=>setCompatibility(p=>({...p,compatibility:v})),[["compatible",it?"Compatibili":"Compatible"],["caution",it?"Attenzione":"Caution"],["incompatible",it?"Incompatibili":"Incompatible"]])}
          {textarea(it?"Motivazione e condizioni":"Reason and conditions",compatibility.notes,v=>setCompatibility(p=>({...p,notes:v})))}
          <Button type="submit" disabled={saving}>{it?"Salva regola":"Save rule"}</Button>
        </form>
        <div className="ecosys-history">{data.compatibilityRules.map(row=><div className="ecosys-reading" key={row.id}><strong>{String(row.speciesAKey)} + {String(row.speciesBKey)} · {String(row.compatibility)}</strong>{row.notes && <span>{String(row.notes)}</span>}</div>)}</div>
      </>}
    </>}
  </section>;
}
