import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Alert, Button } from "../components/ui";

type Bird = { id: string; name: string; species: string; sex: string; identifier: string | null };
type Profile = { ringType: string; ringNumber: string | null; ringYear: number | null; citesNumber: string | null; citesAnnex: string | null; citesAuthority: string | null; citesIssuedAt: string | null; citesExpiresAt: string | null; notes: string | null };
type Pair = { id: string; femaleAnimalId: string; maleAnimalId: string; pairedAt: string; separatedAt: string | null; status: string; notes: string | null; female: { id: string; name: string; species: string }; male: { id: string; name: string; species: string }; cycle: { id: string; status: string; _count: { clutches: number; offspringBatches: number } } };
type Maintenance = { id: string; occurredAt: string; action: string; area: string | null; products: string | null; nextDueAt: string | null; notes: string | null };

const emptyProfile: Profile = { ringType: "none", ringNumber: null, ringYear: null, citesNumber: null, citesAnnex: null, citesAuthority: null, citesIssuedAt: null, citesExpiresAt: null, notes: null };
const dateValue = () => new Date().toISOString().slice(0, 10);

export function BirdManagementPanel({ locale, birds, aviaryId, navigate }: { locale: Locale; birds: Bird[]; aviaryId: string | null; navigate: (path: string) => void }) {
  const it = locale === "it";
  const [birdId, setBirdId] = useState("");
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [maintenance, setMaintenance] = useState<Maintenance[]>([]);
  const [femaleId, setFemaleId] = useState("");
  const [maleId, setMaleId] = useState("");
  const [pairedAt, setPairedAt] = useState(dateValue());
  const [maintenanceAction, setMaintenanceAction] = useState("cleaning");
  const [maintenanceArea, setMaintenanceArea] = useState("");
  const [maintenanceProducts, setMaintenanceProducts] = useState("");
  const [maintenanceNextDue, setMaintenanceNextDue] = useState("");
  const [maintenanceNotes, setMaintenanceNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { if (!birds.some(b => b.id === birdId)) setBirdId(birds[0]?.id ?? ""); }, [birds, birdId]);
  useEffect(() => { if (!birds.some(b => b.id === femaleId && b.sex === "female")) setFemaleId(birds.find(b => b.sex === "female")?.id ?? ""); if (!birds.some(b => b.id === maleId && b.sex === "male")) setMaleId(birds.find(b => b.sex === "male")?.id ?? ""); }, [birds, femaleId, maleId]);
  async function load() {
    if (!birdId) { setProfile(emptyProfile); return; }
    const p = await api.get<{ profile: Profile | null }>(`/birds/${encodeURIComponent(birdId)}/profile`);
    setProfile(p.profile ?? emptyProfile);
  }
  useEffect(() => { void load().catch(e => setError(e instanceof ApiError ? e.message : (it ? "Impossibile caricare la scheda uccello." : "Could not load bird profile."))); }, [birdId, it]);
  useEffect(() => {
    let active = true;
    Promise.all([
      api.get<{ pairs: Pair[] }>("/bird-breeding-pairs"),
      aviaryId ? api.get<{ records: Maintenance[] }>(`/aviaries/${encodeURIComponent(aviaryId)}/maintenance`) : Promise.resolve({ records: [] as Maintenance[] }),
    ]).then(([p,m]) => { if(active){setPairs(p.pairs);setMaintenance(m.records);} })
      .catch(e => { if(active)setError(e instanceof ApiError?e.message:(it?"Impossibile caricare i registri.":"Could not load bird registers.")); });
    return () => { active = false; };
  }, [aviaryId, it]);

  async function run(event: FormEvent, action: () => Promise<void>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (e) { setError(e instanceof ApiError ? e.message : (it ? "Operazione non riuscita." : "Operation failed.")); }
    finally { setBusy(false); }
  }
  function changeProfile<K extends keyof Profile>(key: K, value: Profile[K]) { setProfile(p => ({...p,[key]:value})); }
  async function saveProfile(e: FormEvent) {
    await run(e, async () => {
      const result = await api.put<{profile:Profile}>(`/birds/${encodeURIComponent(birdId)}/profile`, profile);
      setProfile(result.profile); setNotice(it?"Identificazione e dati CITES salvati.":"Identification and CITES details saved.");
    });
  }
  async function createPair(e: FormEvent) {
    await run(e, async () => {
      await api.post("/bird-breeding-pairs",{femaleAnimalId:femaleId,maleAnimalId:maleId,pairedAt});
      const result=await api.get<{pairs:Pair[]}>("/bird-breeding-pairs");setPairs(result.pairs);
      setNotice(it?"Coppia registrata. Il ciclo riproduttivo è pronto per deposizioni e covate.":"Pair recorded. Its reproduction cycle is ready for egg laying and clutches.");
    });
  }
  async function updatePair(pair:Pair,status:"paused"|"active"|"completed"|"cancelled") {
    setBusy(true);setError("");try {
      await api.patch(`/bird-breeding-pairs/${encodeURIComponent(pair.id)}`,{status,...(["completed","cancelled"].includes(status)?{separatedAt:dateValue()}: {})});
      setPairs((await api.get<{pairs:Pair[]}>("/bird-breeding-pairs")).pairs);
    } catch(e){setError(e instanceof ApiError?e.message:(it?"Aggiornamento non riuscito.":"Update failed."));} finally{setBusy(false);}
  }
  async function createMaintenance(e:FormEvent) {
    if (!aviaryId) return;
    await run(e,async()=>{
      await api.post(`/aviaries/${encodeURIComponent(aviaryId)}/maintenance`,{occurredAt:new Date().toISOString(),action:maintenanceAction,area:maintenanceArea||null,products:maintenanceProducts||null,nextDueAt:maintenanceNextDue?new Date(maintenanceNextDue+"T12:00:00").toISOString():null,notes:maintenanceNotes||null});
      setMaintenance((await api.get<{records:Maintenance[]}>(`/aviaries/${encodeURIComponent(aviaryId)}/maintenance`)).records);
      setMaintenanceArea("");setMaintenanceProducts("");setMaintenanceNextDue("");setMaintenanceNotes("");setNotice(it?"Manutenzione registrata.":"Maintenance recorded.");
    });
  }
  const field=(label:string,value:string,onChange:(v:string)=>void,type="text")=><label className="field"><span className="field-label">{label}</span><input className="control" type={type} value={value} onChange={e=>onChange(e.target.value)}/></label>;

  if (!birds.length) return <section className="panel"><h3>{it?"Gestione individuale e riproduzione":"Individual care and breeding"}</h3><p className="ecosys-empty">{it?"Registra prima gli uccelli nella sezione Animali.":"Add birds in the Animals section first."}</p></section>;
  return <section className="panel ecosys-details">
    <div className="panel-header"><div><h2>{it?"Anagrafiche, riproduzione e cura":"Bird profiles, breeding and care"}</h2><p>{it?"Identificazione individuale, coppie, covate, salute e manutenzione della voliera.":"Individual identification, pairs, clutches, health and aviary maintenance."}</p></div></div>
    {error&&<Alert tone="danger">{error}</Alert>}{notice&&<Alert tone="success">{notice}</Alert>}
    <section className="form-grid">
      <h3>{it?"Scheda individuale e identificazione":"Individual profile and identification"}</h3>
      <label className="field"><span className="field-label">{it?"Uccello":"Bird"}</span><select className="control" value={birdId} onChange={e=>setBirdId(e.target.value)}>{birds.map(b=><option key={b.id} value={b.id}>{b.name} · {b.species}</option>)}</select></label>
      <form className="form-grid" onSubmit={saveProfile}>
        <label className="field"><span className="field-label">{it?"Tipo identificativo":"Identification type"}</span><select className="control" value={profile.ringType} onChange={e=>changeProfile("ringType",e.target.value)}><option value="none">{it?"Nessuno":"None"}</option><option value="unspecified">{it?"Non specificato":"Unspecified"}</option><option value="closed">{it?"Anello chiuso":"Closed ring"}</option><option value="open">{it?"Anello aperto":"Open ring"}</option><option value="microchip">Microchip</option></select></label>
        {field(it?"Numero anello / identificativo":"Ring / identifier number",profile.ringNumber??"",v=>changeProfile("ringNumber",v||null))}
        {field(it?"Anno anello":"Ring year",profile.ringYear===null?"":String(profile.ringYear),v=>changeProfile("ringYear",v===""?null:Number(v)),"number")}
        <h4>{it?"Dati CITES (solo se applicabili)":"CITES details (where applicable)"}</h4>
        {field(it?"Numero certificato CITES":"CITES certificate number",profile.citesNumber??"",v=>changeProfile("citesNumber",v||null))}
        {field(it?"Appendice / allegato":"Annex",profile.citesAnnex??"",v=>changeProfile("citesAnnex",v||null))}
        {field(it?"Autorità emittente":"Issuing authority",profile.citesAuthority??"",v=>changeProfile("citesAuthority",v||null))}
        {field(it?"Data rilascio":"Issue date",profile.citesIssuedAt?.slice(0,10)??"",v=>changeProfile("citesIssuedAt",v||null),"date")}
        {field(it?"Data scadenza":"Expiry date",profile.citesExpiresAt?.slice(0,10)??"",v=>changeProfile("citesExpiresAt",v||null),"date")}
        <label className="field"><span className="field-label">{it?"Note":"Notes"}</span><textarea className="control" value={profile.notes??""} onChange={e=>changeProfile("notes",e.target.value||null)}/></label>
        <Button type="submit" disabled={busy||!birdId}>{it?"Salva scheda":"Save profile"}</Button>
      </form>
      <div className="inline-actions"><Button type="button" variant="secondary" onClick={()=>navigate(`/animals/${birdId}`)}>{it?"Apri cartella sanitaria, foto e referti":"Open health record, photos and reports"}</Button><Button type="button" variant="secondary" onClick={()=>navigate("/documents")}>{it?"Apri archivio documenti":"Open document archive"}</Button></div>
    </section>
    <div className="divider"/>
    <section className="form-grid">
      <h3>{it?"Coppie riproduttrici":"Breeding pairs"}</h3>
      <form className="form-grid" onSubmit={createPair}>
        <label className="field"><span className="field-label">{it?"Femmina":"Female"}</span><select className="control" required value={femaleId} onChange={e=>setFemaleId(e.target.value)}>{birds.filter(b=>b.sex==="female").map(b=><option key={b.id} value={b.id}>{b.name} · {b.species}</option>)}</select></label>
        <label className="field"><span className="field-label">{it?"Maschio":"Male"}</span><select className="control" required value={maleId} onChange={e=>setMaleId(e.target.value)}>{birds.filter(b=>b.sex==="male").map(b=><option key={b.id} value={b.id}>{b.name} · {b.species}</option>)}</select></label>
        {field(it?"Data formazione coppia":"Pairing date",pairedAt,setPairedAt,"date")}
        <Button type="submit" disabled={busy||!femaleId||!maleId||femaleId===maleId}>{it?"Registra coppia":"Record pair"}</Button>
      </form>
      <div className="ecosys-history">{pairs.length===0?<p className="ecosys-empty">{it?"Nessuna coppia registrata.":"No breeding pairs recorded."}</p>:pairs.map(p=><article className="ecosys-reading" key={p.id}><strong>{p.female.name} × {p.male.name} · {p.status}</strong><span>{it?"Dal ":"Since "}{new Date(p.pairedAt).toLocaleDateString(it?"it-IT":"en-GB")} · {p.cycle._count.clutches} {it?"cove":"clutches"} · {p.cycle._count.offspringBatches} {it?"registri piccoli":"offspring batches"}</span><div className="inline-actions"><Button size="sm" onClick={()=>navigate(`/reproduction-cycles/${p.cycle.id}`)}>{it?"Apri ciclo, deposizioni e schiuse":"Open cycle, eggs and hatching"}</Button>{p.status==="active"&&<Button size="sm" variant="secondary" disabled={busy} onClick={()=>void updatePair(p,"paused")}>{it?"Sospendi":"Pause"}</Button>}{p.status==="paused"&&<Button size="sm" variant="secondary" disabled={busy} onClick={()=>void updatePair(p,"active")}>{it?"Riattiva":"Resume"}</Button>}{["active","paused"].includes(p.status)&&<Button size="sm" variant="danger" disabled={busy} onClick={()=>void updatePair(p,"completed")}>{it?"Concludi coppia":"End pair"}</Button>}</div></article>)}</div>
    </section>
    <div className="divider"/>
    <div className="inline-actions"><Button type="button" variant="secondary" onClick={()=>navigate(`/animals/${birdId}`)}>{it?"Apri cartella sanitaria, foto e referti":"Open health record, photos and reports"}</Button><Button type="button" variant="secondary" onClick={()=>navigate("/documents")}>{it?"Apri archivio documenti":"Open document archive"}</Button></div>
    {aviaryId && <>
    <div className="divider"/>
    <section className="form-grid">
      <h3>{it?"Pulizia e manutenzione voliera":"Aviary cleaning and maintenance"}</h3>
      <form className="form-grid" onSubmit={createMaintenance}>
        <label className="field"><span className="field-label">{it?"Intervento":"Action"}</span><select className="control" value={maintenanceAction} onChange={e=>setMaintenanceAction(e.target.value)}><option value="cleaning">{it?"Pulizia":"Cleaning"}</option><option value="disinfection">{it?"Disinfezione":"Disinfection"}</option><option value="inspection">{it?"Ispezione":"Inspection"}</option><option value="repair">{it?"Riparazione":"Repair"}</option><option value="other">{it?"Altro":"Other"}</option></select></label>
        {field(it?"Area / componente":"Area / component",maintenanceArea,setMaintenanceArea)}
        {field(it?"Prodotti utilizzati":"Products used",maintenanceProducts,setMaintenanceProducts)}
        {field(it?"Prossima manutenzione":"Next maintenance",maintenanceNextDue,setMaintenanceNextDue,"datetime-local")}
        <label className="field"><span className="field-label">{it?"Note":"Notes"}</span><textarea className="control" value={maintenanceNotes} onChange={e=>setMaintenanceNotes(e.target.value)}/></label>
        <Button type="submit" disabled={busy}>{it?"Registra intervento":"Record maintenance"}</Button>
      </form>
      <div className="ecosys-history">{maintenance.map(m=><article className="ecosys-reading" key={m.id}><strong>{m.action} · {new Date(m.occurredAt).toLocaleString(it?"it-IT":"en-GB")}</strong><span>{[m.area,m.products].filter(Boolean).join(" · ")}</span>{m.nextDueAt&&<span>{it?"Prossima: ":"Next: "}{new Date(m.nextDueAt).toLocaleString(it?"it-IT":"en-GB")}</span>}{m.notes&&<p>{m.notes}</p>}</article>)}</div>
    </section>
    </>}
  </section>;
}
