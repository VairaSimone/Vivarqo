import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { Alert, Button, Field, Input, Panel, PanelHeader, Select, Textarea, useToast } from "../../components/ui";
import type { Locale } from "../../lib/domain";

type Move = { id: string; movedAt: string; reason?: string | null; fromLocation?: { name: string } | null; toLocation?: { name: string } | null };
type Transfer = { id: string; transferType: string; recipientName: string; recipientEmail?: string | null; recipientBreeder?: string | null; transferredAt: string; priceCents?: string | null; notes?: string | null };
export function AnimalMovementHistory({ id, locale, readOnly }: { id: string; locale: Locale; readOnly: boolean }) {
 const it=locale==="it"; const [moves,setMoves]=useState<Move[]>([]); const [transfers,setTransfers]=useState<Transfer[]>([]);
 const [type,setType]=useState("sale"); const [recipientName,setRecipientName]=useState(""); const [recipientEmail,setRecipientEmail]=useState(""); const [recipientBreeder,setRecipientBreeder]=useState(""); const [date,setDate]=useState(new Date().toISOString().slice(0,16)); const [price,setPrice]=useState(""); const [notes,setNotes]=useState(""); const [error,setError]=useState(""); const [busy,setBusy]=useState(false); const {toast,show}=useToast();
 async function reload(){const [m,t]=await Promise.all([api.get<{moves:Move[]}>(`/animals/${id}/location-history`),api.get<{transfers:Transfer[]}>(`/animals/${id}/transfers`)]);setMoves(m.moves);setTransfers(t.transfers);}
 useEffect(()=>{void reload().catch(e=>setError(e instanceof ApiError?e.message:"Unable to load history"));},[id]);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{await api.post(`/animals/${id}/transfers`,{type,recipientName:recipientName.trim(),recipientEmail:recipientEmail.trim()||null,recipientBreeder:recipientBreeder.trim()||null,transferredAt:new Date(date).toISOString(),priceCents:price===""?null:Math.round(Number(price)*100),notes:notes.trim()||null});setRecipientName("");setRecipientEmail("");setRecipientBreeder("");setPrice("");setNotes("");await reload();show(it?"Cessione registrata.":"Transfer recorded.");}catch(e){setError(e instanceof ApiError?e.message:"Unable to save transfer");}finally{setBusy(false);}}
 return <div className="detail-grid">
 <Panel><PanelHeader title={it?"Storico spostamenti":"Location history"}/>{moves.length? <div className="record-list">{moves.map(m=><div className="record-row" key={m.id}><div><strong>{m.fromLocation?.name??(it?"Non assegnato":"Unassigned")} → {m.toLocation?.name??(it?"Non assegnato":"Unassigned")}</strong><small>{new Date(m.movedAt).toLocaleString(it?"it-IT":"en-GB")}</small>{m.reason&&<small>{m.reason}</small>}</div></div>)}</div>:<p className="muted-note">{it?"Nessuno spostamento registrato.":"No location moves recorded."}</p>}</Panel>
 <Panel><PanelHeader title={it?"Cessioni e trasferimenti":"Sales and transfers"}/>{error&&<Alert tone="danger">{error}</Alert>}
 {transfers.length>0&&<div className="record-list">{transfers.map(t=><div className="record-row" key={t.id}><div><strong>{t.recipientName} · {t.transferType==="sale"?(it?"Vendita":"Sale"):t.transferType==="gift"?(it?"Cessione gratuita":"Gift"):(it?"Trasferimento allevatore":"Breeder transfer")}</strong><small>{new Date(t.transferredAt).toLocaleString(it?"it-IT":"en-GB")} {t.priceCents!=null?" · "+(Number(t.priceCents)/100).toLocaleString(it?"it-IT":"en-GB",{style:"currency",currency:"EUR"}):""}</small>{t.recipientBreeder&&<small>{t.recipientBreeder}</small>}{t.notes&&<small>{t.notes}</small>}</div></div>)}</div>}
 {!readOnly&&<form className="form-stack" onSubmit={submit}><div className="form-grid">
 <Field label={it?"Tipo":"Type"}><Select value={type} onChange={e=>setType(e.target.value)}><option value="sale">{it?"Vendita":"Sale"}</option><option value="gift">{it?"Cessione gratuita":"Gift"}</option><option value="breeder_transfer">{it?"Trasferimento ad allevatore":"Breeder transfer"}</option></Select></Field>
 <Field label={it?"Destinatario":"Recipient"}><Input required maxLength={160} value={recipientName} onChange={e=>setRecipientName(e.target.value)}/></Field>
 <Field label="Email"><Input type="email" maxLength={254} value={recipientEmail} onChange={e=>setRecipientEmail(e.target.value)}/></Field>
 <Field label={it?"Allevatore / attività":"Breeder / business"}><Input maxLength={160} value={recipientBreeder} onChange={e=>setRecipientBreeder(e.target.value)}/></Field>
 <Field label={it?"Data e ora":"Date and time"}><Input required type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/></Field>
 <Field label={it?"Prezzo (€)":"Price (€)"}><Input type="number" min="0" max="1000000" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/></Field>
 </div><Field label={it?"Note":"Notes"}><Textarea rows={2} maxLength={5000} value={notes} onChange={e=>setNotes(e.target.value)}/></Field><Button type="submit" disabled={busy||!recipientName.trim()}>{busy?(it?"Salvataggio…":"Saving…"):(it?"Registra cessione":"Record transfer")}</Button></form>}
 </Panel></div>;
}