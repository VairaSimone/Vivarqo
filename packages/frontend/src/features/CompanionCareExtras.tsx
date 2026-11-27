import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Alert, Button, Field, Input, Panel, Select } from "../components/ui";

type Log = { id: string; kind: "feeding" | "behavior" | "walk"; occurredAt: string; title: string; foodType: string | null; quantity: string | number | null; quantityUnit: string | null; durationMinutes: number | null; distanceKm: string | number | null; mood: string | null; notes: string | null };
type Policy = { id: string; kind: "insurance" | "document"; title: string; provider: string | null; reference: string | null; expiresAt: string; reminderDays: number; notes: string | null };

export function CompanionCareExtras({ animalId, locale }: { animalId: string; locale: Locale }) {
  const it = locale === "it";
  const [logs, setLogs] = useState<Log[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [kind, setKind] = useState<Log["kind"]>("feeding");
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [title, setTitle] = useState("");
  const [foodType, setFoodType] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("g");
  const [duration, setDuration] = useState("");
  const [distance, setDistance] = useState("");
  const [mood, setMood] = useState("");
  const [notes, setNotes] = useState("");
  const [policyKind, setPolicyKind] = useState<Policy["kind"]>("insurance");
  const [policyTitle, setPolicyTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [reference, setReference] = useState("");
  const [expiry, setExpiry] = useState("");
  const [reminderDays, setReminderDays] = useState("30");
  const [policyNotes, setPolicyNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function reload() {
    const [l,p] = await Promise.all([
      api.get<{logs:Log[]}>("/companion-care/logs?animalId="+animalId),
      api.get<{policies:Policy[]}>("/companion-care/policies?animalId="+animalId),
    ]);
    setLogs(l.logs); setPolicies(p.policies);
  }
  useEffect(() => { let active=true; reload().catch((e:unknown)=>{if(active)setError(e instanceof ApiError?e.message:(it?"Caricamento non riuscito.":"Unable to load records."));}); return ()=>{active=false;}; },[animalId,it]);

  async function saveLog(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError("");
    try {
      await api.post("/companion-care/logs",{animalId,kind,occurredAt:new Date(date+"T12:00:00").toISOString(),title,foodType:kind==="feeding"?(foodType||null):null,quantity:kind==="feeding"?Number(quantity):null,quantityUnit:kind==="feeding"?unit:null,durationMinutes:kind==="walk"?Number(duration):null,distanceKm:kind==="walk"&&distance?Number(distance):null,mood:mood||null,notes:notes||null});
      await reload(); setTitle("");setFoodType("");setQuantity("");setDuration("");setDistance("");setMood("");setNotes("");
    } catch(e) {setError(e instanceof ApiError?e.message:(it?"Salvataggio non riuscito.":"Unable to save."));} finally{setSaving(false);}
  }
  async function savePolicy(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();setSaving(true);setError("");
    try {
      await api.post("/companion-care/policies",{animalId,kind:policyKind,title:policyTitle,provider:provider||null,reference:reference||null,expiresAt:expiry,reminderDays:Number(reminderDays),notes:policyNotes||null});
      await reload();setPolicyTitle("");setProvider("");setReference("");setExpiry("");setPolicyNotes("");
    } catch(e){setError(e instanceof ApiError?e.message:(it?"Salvataggio non riuscito.":"Unable to save."));} finally{setSaving(false);}
  }
  async function deleteLog(id:string){if(!window.confirm(it?"Eliminare la registrazione?":"Delete this entry?"))return;setSaving(true);try{await api.delete("/companion-care/logs/"+id);await reload();}catch(e){setError(e instanceof ApiError?e.message:"Delete failed");}finally{setSaving(false);}}
  async function deletePolicy(id:string){if(!window.confirm(it?"Eliminare la scadenza e il relativo promemoria?":"Delete expiry and its reminder?"))return;setSaving(true);try{await api.delete("/companion-care/policies/"+id);await reload();}catch(e){setError(e instanceof ApiError?e.message:"Delete failed");}finally{setSaving(false);}}

  return <div className="page-stack">
    {error && <Alert tone="danger">{error}</Alert>}
    <Panel><h2>{it?"Alimentazione, comportamento e passeggiate":"Feeding, behavior & walks"}</h2>
      <form className="form-grid" onSubmit={saveLog}>
        <Field label={it?"Tipo":"Type"}><Select value={kind} onChange={e=>setKind(e.target.value as Log["kind"])}><option value="feeding">{it?"Alimentazione":"Feeding"}</option><option value="behavior">{it?"Comportamento":"Behavior"}</option><option value="walk">{it?"Passeggiata / attività":"Walk / activity"}</option></Select></Field>
        <Field label={it?"Data":"Date"}><Input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></Field>
        <Field label={kind==="feeding"?(it?"Pasto":"Meal"):kind==="walk"?(it?"Attività":"Activity"):(it?"Comportamento osservato":"Observed behavior")}><Input required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></Field>
        {kind==="feeding" && <><Field label={it?"Alimento":"Food"}><Input value={foodType} onChange={e=>setFoodType(e.target.value)} maxLength={120}/></Field><Field label={it?"Quantità":"Quantity"}><Input type="number" min="0.01" step="0.01" required value={quantity} onChange={e=>setQuantity(e.target.value)}/></Field><Field label={it?"Unità":"Unit"}><Select value={unit} onChange={e=>setUnit(e.target.value)}><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="portion">{it?"porzione":"portion"}</option></Select></Field></>}
        {kind==="walk" && <><Field label={it?"Durata (minuti)":"Duration (minutes)"}><Input type="number" min="1" max="1440" required value={duration} onChange={e=>setDuration(e.target.value)}/></Field><Field label={it?"Distanza (km)":"Distance (km)"}><Input type="number" min="0.01" step="0.01" value={distance} onChange={e=>setDistance(e.target.value)}/></Field></>}
        {kind!=="feeding" && <Field label={it?"Umore / stato":"Mood / state"}><Input maxLength={40} value={mood} onChange={e=>setMood(e.target.value)}/></Field>}
        <Field label={it?"Note":"Notes"}><Input maxLength={5000} value={notes} onChange={e=>setNotes(e.target.value)}/></Field>
        <Button type="submit" disabled={saving}>{it?"Registra":"Save entry"}</Button>
      </form>
      {logs.length===0?<p>{it?"Nessuna registrazione.":"No entries yet."}</p>:<div className="ecosys-history">{logs.map(log=><article className="ecosys-reading" key={log.id}><strong>{log.title}</strong><span>{log.kind} · {new Date(log.occurredAt).toLocaleDateString(it?"it-IT":"en-GB")}</span>{log.kind==="feeding"&&<span>{[log.foodType,log.quantity!=null?String(log.quantity)+" "+log.quantityUnit:""].filter(Boolean).join(" · ")}</span>}{log.kind==="walk"&&<span>{[log.durationMinutes?log.durationMinutes+" min":"",log.distanceKm?log.distanceKm+" km":""].filter(Boolean).join(" · ")}</span>}{log.mood&&<span>{log.mood}</span>}{log.notes&&<span>{log.notes}</span>}<Button size="sm" variant="danger" disabled={saving} onClick={()=>void deleteLog(log.id)}>{it?"Elimina":"Delete"}</Button></article>)}</div>}
    </Panel>
    <Panel><h2>{it?"Assicurazioni e documenti in scadenza":"Insurance & expiring documents"}</h2>
      <form className="form-grid" onSubmit={savePolicy}>
        <Field label={it?"Tipo":"Type"}><Select value={policyKind} onChange={e=>setPolicyKind(e.target.value as Policy["kind"])}><option value="insurance">{it?"Assicurazione":"Insurance"}</option><option value="document">{it?"Documento / certificato":"Document / certificate"}</option></Select></Field>
        <Field label={it?"Nome":"Name"}><Input required maxLength={160} value={policyTitle} onChange={e=>setPolicyTitle(e.target.value)}/></Field>
        <Field label={it?"Compagnia / ente":"Provider"}><Input maxLength={160} value={provider} onChange={e=>setProvider(e.target.value)}/></Field>
        <Field label={it?"Numero polizza / riferimento":"Policy / reference"}><Input maxLength={120} value={reference} onChange={e=>setReference(e.target.value)}/></Field>
        <Field label={it?"Data scadenza":"Expiry date"}><Input type="date" required value={expiry} onChange={e=>setExpiry(e.target.value)}/></Field>
        <Field label={it?"Promemoria anticipato (giorni)":"Reminder in advance (days)"}><Input type="number" min="0" max="365" value={reminderDays} onChange={e=>setReminderDays(e.target.value)}/></Field>
        <Field label={it?"Note":"Notes"}><Input maxLength={5000} value={policyNotes} onChange={e=>setPolicyNotes(e.target.value)}/></Field>
        <Button type="submit" disabled={saving}>{it?"Salva scadenza":"Save expiry"}</Button>
      </form>
      {policies.length===0?<p>{it?"Nessuna scadenza registrata.":"No expiry records."}</p>:<div className="ecosys-history">{policies.map(p=><article className="ecosys-reading" key={p.id}><strong>{p.title}</strong><span>{p.kind==="insurance"?(it?"Assicurazione":"Insurance"):(it?"Documento":"Document")} · {new Date(p.expiresAt).toLocaleDateString(it?"it-IT":"en-GB")}</span>{p.provider&&<span>{p.provider}{p.reference?" · "+p.reference:""}</span>}<span>{it?"Promemoria ":"Reminder "}{p.reminderDays} {it?"giorni prima":"days before"}</span>{p.notes&&<span>{p.notes}</span>}<Button size="sm" variant="danger" disabled={saving} onClick={()=>void deletePolicy(p.id)}>{it?"Elimina":"Delete"}</Button></article>)}</div>}
    </Panel>
  </div>;
}
