import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { AnyRecord, CommonHubProps } from "./types";
import { errorMessage } from "./types";
import { Button, Field } from "./ui/FormControls";
import { apiRequest, apiUploadDocument, downloadPrivateDocument } from "./api/api";
import { createQrMatrix, qrSvgSource } from "./qr";
import { Dialog } from "./ui/Dialog";
import { Icon } from "./ui/Icon";
import { useConfirmDialog } from "./ui/ConfirmDialog";

const arrayOf = (value: unknown): AnyRecord[] => Array.isArray(value) ? value as AnyRecord[] : value && typeof value === "object" ? Object.values(value as AnyRecord).find(Array.isArray) as AnyRecord[] || [] : [];
const displayDate = (value?: string | Date | null) => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value)) : "—";
const bytes = (value: string | number | null | undefined) => {
  const size = Number(value || 0);
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
};
const fields = [
  ["name", "Nome"], ["species", "Specie"], ["morph", "Morph"], ["sex", "Sesso"], ["birthDate", "Data di nascita"]
];
function QRCode({ value }) {
  const result = useMemo(() => {
    if (!value) return null;
    try { return createQrMatrix(value); } catch { return null; }
  }, [value]);
  if (!result) return <p className="muted">Il link è troppo lungo per generare il QR in questo formato.</p>;
  const size = result.length;
  let path = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (result[y][x]) path += "M" + (x + 4) + " " + (y + 4) + "h1v1h-1z";
  return <svg className="qr-svg" role="img" aria-label="Codice QR del profilo pubblico" viewBox={"0 0 " + (size + 8) + " " + (size + 8)} shapeRendering="crispEdges"><rect x={0} y={0} width={size + 8} height={size + 8} fill="#fff"/><path d={path} fill="#14231d"/></svg>;
}
function downloadQr(value: string, name?: string) {
  const source = qrSvgSource(value, 12, 4);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = (name || "vivarqo-profilo") + "-qr.svg";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DocumentsHub({ onNotice = () => {}, owner }: CommonHubProps) {
  const confirmAction = useConfirmDialog();
  const [documents, setDocuments] = useState<AnyRecord[]>([]);
  const [documentsPage, setDocumentsPage] = useState(1);
  const [animalsPage, setAnimalsPage] = useState(1);
  const [animalsPagination, setAnimalsPagination] = useState({ page: 1, pageSize: 100, total: 0, totalPages: 1 });
  const [cyclesPage, setCyclesPage] = useState(1);
  const [cyclesPagination, setCyclesPagination] = useState({ page: 1, pageSize: 100, total: 0, totalPages: 1 });
  const [documentsPagination, setDocumentsPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [animals, setAnimals] = useState<AnyRecord[]>([]);
  const [cycles, setCycles] = useState<AnyRecord[]>([]);
  const [selectedAnimal, setSelectedAnimal] = useState("");
  const [selectedCycle, setSelectedCycle] = useState("");
  const [file, setFile] = useState<AnyRecord | null>(null);
  const [category, setCategory] = useState("other");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [share, setShare] = useState<AnyRecord | null>(null);
  const [shareFields, setShareFields] = useState(["name", "species", "morph"]);
  const [publicDescription, setPublicDescription] = useState("");
  const [shareEnabled, setShareEnabled] = useState(false);
  const [error, setError] = useState("");
  const [editingDocument, setEditingDocument] = useState<AnyRecord | null>(null);
  const [savingDocumentEdit, setSavingDocumentEdit] = useState(false);

  const loadLists = useCallback(async () => {
    const [docs, animalResponse, cycleResponse] = await Promise.all([
      apiRequest("documents?page=" + documentsPage + "&pageSize=50"),
      apiRequest("animals?page=" + animalsPage + "&pageSize=100"),
      apiRequest("reproduction-cycles?page=" + cyclesPage + "&pageSize=100")
    ]);
    setDocuments(arrayOf(docs.documents ?? docs));
    setDocumentsPagination(docs.pagination || { page: documentsPage, pageSize: 50, total: arrayOf(docs.documents ?? docs).length, totalPages: 1 });
    const nextAnimals = arrayOf(animalResponse.animals ?? animalResponse);
    const nextCycles = arrayOf(cycleResponse.cycles ?? cycleResponse);
    setAnimals(previous => Array.from(new Map([...previous, ...nextAnimals].map(animal => [animal.id, animal])).values()));
    setCycles(previous => Array.from(new Map([...previous, ...nextCycles].map(cycle => [cycle.id, cycle])).values()));
    setAnimalsPagination(animalResponse.pagination || { page: animalsPage, pageSize: 100, total: nextAnimals.length, totalPages: 1 });
    setCyclesPagination(cycleResponse.pagination || { page: cyclesPage, pageSize: 100, total: nextCycles.length, totalPages: 1 });
    if (!selectedAnimal && nextAnimals.length) setSelectedAnimal(nextAnimals[0].id);
  }, [selectedAnimal, documentsPage, animalsPage, cyclesPage]);

  const loadShare = useCallback(async id => {
    if (!id) { setShare(null); setShareFields(["name", "species", "morph"]); setPublicDescription(""); setShareEnabled(false); return; }
    try {
      const result = await apiRequest("animals/" + id + "/public-share");
      const saved = result.share || null;
      setShare(saved);
      setShareFields(Array.isArray(saved?.visibleFields) && saved.visibleFields.length ? saved.visibleFields : ["name", "species", "morph"]);
      setPublicDescription(saved?.publicDescription || "");
      setShareEnabled(Boolean(saved?.isEnabled));
    } catch (e) {
      if (e.status === 404) { setShare(null); setShareFields(["name", "species", "morph"]); setPublicDescription(""); setShareEnabled(false); }
      else setError(errorMessage(e));
    }
  }, []);

  const reload = useCallback(async () => {
    setBusy(true); setError("");
    try { await loadLists(); await loadShare(selectedAnimal); }
    catch (e) { setError(errorMessage(e) || "Impossibile caricare documenti e condivisioni."); }
    finally { setBusy(false); }
  }, [loadLists, loadShare, selectedAnimal]);

  useEffect(() => { let live = true; void loadLists().catch(e => setError(errorMessage(e))).finally(() => { if (live) setListsLoaded(true); }); return () => { live = false; }; }, [loadLists]);
  useEffect(() => { void loadShare(selectedAnimal); }, [selectedAnimal, loadShare]);

  const upload = async e => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!file) { onNotice("Seleziona un file prima di caricare.", "error"); return; }
    if (!selectedAnimal && !selectedCycle) { onNotice("Collega il documento a un animale o a un ciclo riproduttivo.", "error"); return; }
    setBusy(true);
    try {
      await apiUploadDocument(file, { animalId: selectedAnimal || null, cycleId: selectedAnimal ? null : selectedCycle || null, category, note });
      setFile(null); setNote("");
      form.reset();
      onNotice("Documento caricato nell'archivio privato.");
      await loadLists();
    } catch (err) { onNotice(errorMessage(err), "error"); }
    finally { setBusy(false); }
  };
  const removeDocument = async doc => {
    if (!(await confirmAction({ title: "Eliminare il documento?", message: "“" + doc.originalFilename + "” verrà eliminato definitivamente dall’archivio privato.", confirmLabel: "Elimina documento", danger: true }))) return;
    try { await apiRequest("documents/" + doc.id, { method: "DELETE", body: {} }); onNotice("Documento eliminato."); await loadLists(); }
    catch (err) { onNotice(errorMessage(err), "error"); }
  };
  const editDocument = doc => setEditingDocument({ ...doc });
  const saveDocumentEdit = async event => {
    event.preventDefault();
    if (!editingDocument) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const category = String(values.category || "").trim();
    if (!category) { onNotice("Seleziona una categoria per il documento.", "error"); return; }
    setSavingDocumentEdit(true);
    try {
      await apiRequest("documents/" + editingDocument.id, { method: "PATCH", body: { category, note: String(values.note || "").trim() || null } });
      setEditingDocument(null);
      onNotice("Metadati del documento aggiornati.", "success");
      await loadLists();
    } catch (err) { onNotice(errorMessage(err) || "Impossibile aggiornare il documento.", "error"); }
    finally { setSavingDocumentEdit(false); }
  };
  const saveShare = async e => {
    e.preventDefault();
    if (!selectedAnimal) { onNotice("Seleziona un animale per gestire il suo profilo QR.", "error"); return; }
    setBusy(true);
    try {
      const body = { visibleFields: shareFields, publicDescription: publicDescription.trim() || null, isEnabled: shareEnabled };
      const response = share?.id
        ? await apiRequest("public-shares/" + share.id, { method: "PATCH", body })
        : await apiRequest("animals/" + selectedAnimal + "/public-share", { method: "POST", body });
      const saved = response.share || response;
      setShare(saved);
      onNotice(shareEnabled ? "Profilo pubblico aggiornato e attivo." : "Impostazioni del profilo aggiornate.");
      await loadShare(selectedAnimal);
    } catch (err) { onNotice(errorMessage(err), "error"); }
    finally { setBusy(false); }
  };
  const revokeShare = async () => {
    if (!share?.id) { setShareEnabled(false); return; }
    if (!(await confirmAction({ title: "Revocare il link pubblico?", message: "Il QR già stampato non mostrerà più il profilo finché non riattivi la condivisione.", confirmLabel: "Revoca link", danger: true }))) return;
    try {
      const result = await apiRequest("public-shares/" + share.id, { method: "PATCH", body: { revoke: true } });
      setShare(result.share || { ...share, isEnabled: false, revokedAt: new Date().toISOString() });
      setShareEnabled(false);
      onNotice("Link pubblico revocato.");
    } catch (err) { onNotice(errorMessage(err), "error"); }
  };
  const publicUrl = shareEnabled && share?.isEnabled && share?.revokedAt == null ? (share.url || (share.slug ? window.location.origin + "/public/animals/" + share.slug : "")) : "";
  const selectedName = animals.find(a => a.id === selectedAnimal)?.name || "animale";

  return <div className="advanced-stack">
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">ARCHIVIO PRIVATO</p><h2>Documenti</h2><p className="subheading">PDF e immagini fino a 10 MB. I file vengono caricati nell'archivio privato dell'account.</p></div><Button onClick={() => reload()} disabled={busy}>↻ Aggiorna</Button></div>
      {error && <p className="form-message" role="alert">{error}</p>}
      <form className="form-grid" onSubmit={upload}>
        <Field label="Animale collegato"><select value={selectedAnimal} onChange={e => { setSelectedAnimal(e.target.value); if (e.target.value) setSelectedCycle(""); }}><option value="">— Seleziona un animale —</option>{animals.map(a => <option value={a.id} key={a.id}>{a.name} · {a.species}</option>)}</select></Field>
        {animalsPagination.totalPages > 1 && <div className="form-full inline-actions"><span className="muted">Animali · pagina {animalsPagination.page}/{animalsPagination.totalPages} ({animalsPagination.total} totali)</span><Button type="button" disabled={animalsPage <= 1 || busy} onClick={() => setAnimalsPage(p => p - 1)}>← Precedenti</Button><Button type="button" disabled={animalsPage >= animalsPagination.totalPages || busy} onClick={() => setAnimalsPage(p => p + 1)}>Altri animali →</Button></div>}
        <Field label="Ciclo riproduttivo"><select value={selectedCycle} onChange={e => { setSelectedCycle(e.target.value); if (e.target.value) setSelectedAnimal(""); }}><option value="">— Seleziona un ciclo —</option>{cycles.map(c => <option value={c.id} key={c.id}>{c.name || displayDate(c.startedOn)}</option>)}</select></Field>
        {cyclesPagination.totalPages > 1 && <div className="form-full inline-actions"><span className="muted">Cicli · pagina {cyclesPagination.page}/{cyclesPagination.totalPages} ({cyclesPagination.total} totali)</span><Button type="button" disabled={cyclesPage <= 1 || busy} onClick={() => setCyclesPage(p => p - 1)}>← Precedenti</Button><Button type="button" disabled={cyclesPage >= cyclesPagination.totalPages || busy} onClick={() => setCyclesPage(p => p + 1)}>Altri cicli →</Button></div>}
        <Field label="Categoria"><select value={category} onChange={e => setCategory(e.target.value)}>{[["other","Altro"],["identity","Identificazione"],["origin","Provenienza"],["veterinary","Veterinario"],["legal","Documentazione legale"],["contract","Contratti"],["reproduction","Riproduzione"]].map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select></Field>
        <Field label="File"><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} required/></Field>
        <div className="form-full"><Field label="Nota (facoltativa)"><textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={10000}/></Field></div>
        <div className="form-actions form-full"><Button variant="primary" disabled={busy || !file}>{busy ? "Attendi…" : "Carica documento"}</Button></div>
      </form>
      {!listsLoaded && documents.length === 0 ? <p className="loading" role="status">Caricamento documenti…</p> : documents.length === 0 ? <div className="empty-state"><h3>Nessun documento</h3><p>I documenti caricati compariranno qui e resteranno privati finché non li colleghi a una condivisione esplicita.</p></div> :
        <div className="table-wrap"><table><thead><tr><th>Nome file</th><th>Categoria</th><th>Dimensione</th><th>Data</th><th>Collegamento</th><th>Azioni</th></tr></thead><tbody>{documents.map(doc => <tr key={doc.id}><td><strong>{doc.originalFilename}</strong>{doc.note && <small className="table-subtext">{doc.note}</small>}</td><td>{doc.category}</td><td>{bytes(doc.sizeBytes)}</td><td>{displayDate(doc.createdAt)}</td><td>{animals.find(a => a.id === doc.animalId)?.name || cycles.find(c => c.id === doc.cycleId)?.name || (doc.animalId ? "Animale" : doc.cycleId ? "Ciclo riproduttivo" : "—")}</td><td><div className="inline-actions"><Button onClick={() => downloadPrivateDocument(doc.id, doc.originalFilename).catch(e => onNotice(errorMessage(e), "error"))}>Scarica</Button><Button onClick={() => editDocument(doc)}>Modifica</Button><Button variant="danger" onClick={() => removeDocument(doc)}>Elimina</Button></div></td></tr>)}</tbody></table></div>}
      {documentsPagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Pagina {documentsPagination.page || documentsPage} di {documentsPagination.totalPages} · {documentsPagination.total} documenti</span><div className="inline-actions"><Button disabled={documentsPage <= 1 || busy} onClick={() => setDocumentsPage(p => p - 1)}>← Precedente</Button><Button disabled={documentsPage >= documentsPagination.totalPages || busy} onClick={() => setDocumentsPage(p => p + 1)}>Successiva →</Button></div></div>}
    </section>

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">PROFILO PUBBLICO</p><h2>Condivisione e codice QR</h2><p className="subheading">Il link è disattivato per impostazione predefinita. Condividi solo i campi che vuoi rendere pubblici.</p></div></div>
      <form className="form-grid" onSubmit={saveShare}>
        <div className="form-full"><Field label="Animale da condividere"><select value={selectedAnimal} onChange={e => setSelectedAnimal(e.target.value)} required><option value="">Seleziona un animale</option>{animals.map(a => <option value={a.id} key={a.id}>{a.name} · {a.species}</option>)}</select></Field></div>
        <fieldset className="share-fields form-full"><legend>Campi visibili pubblicamente</legend>{fields.map(([key, label]) => <label className="check-row" key={key}><input type="checkbox" checked={shareFields.includes(key)} onChange={e => setShareFields(prev => e.target.checked ? [...prev, key] : prev.filter(x => x !== key))}/>{label}</label>)}</fieldset>
        <div className="form-full"><Field label="Descrizione pubblica (facoltativa)"><textarea rows={3} maxLength={5000} value={publicDescription} onChange={e => setPublicDescription(e.target.value)} placeholder="Descrizione pensata per chi apre il QR."/></Field></div>
        <label className="check-row form-full"><input type="checkbox" checked={shareEnabled} onChange={e => setShareEnabled(e.target.checked)}/> Attiva il link pubblico</label>
        <div className="form-actions form-full"><Button variant="primary" disabled={busy || !selectedAnimal || shareFields.length === 0}>Salva condivisione</Button>{share?.id && <Button type="button" variant="danger" onClick={revokeShare}>Revoca link</Button>}</div>
      </form>
      {share && <div className="share-preview">
        <div><span className={"pill " + (shareEnabled && share.isEnabled ? "sage" : "danger")}>{shareEnabled && share.isEnabled ? "Link attivo" : "Link disattivato"}</span><h3>QR di {selectedName}</h3><p>Il codice viene generato sul dispositivo: il link non viene inviato a un servizio QR esterno.</p>{publicUrl && <p className="share-url"><a href={publicUrl} target="_blank" rel="noopener noreferrer">{publicUrl}</a></p>}<div className="inline-actions"><Button disabled={!publicUrl || !(shareEnabled && share.isEnabled)} onClick={() => { void navigator.clipboard?.writeText(publicUrl).then(() => onNotice("Link copiato.")).catch(() => onNotice("Copia non disponibile in questo browser.", "error")); }}>Copia link</Button><Button disabled={!publicUrl || !(shareEnabled && share.isEnabled)} onClick={() => { try { downloadQr(publicUrl, selectedName.toLowerCase().replace(/[^a-z0-9]+/g, "-")); } catch (e) { onNotice(errorMessage(e), "error"); } }}>Scarica QR SVG</Button></div></div>
        <div className="qr-frame">{shareEnabled && share.isEnabled ? <QRCode value={publicUrl}/> : <div className="qr-disabled">Attiva e salva la condivisione per rendere disponibile il QR.</div>}</div>
      </div>}
    </section>
    {editingDocument && <Dialog title="Modifica documento" description="Aggiorna la categoria e la nota conservate nell’archivio privato." onClose={() => setEditingDocument(null)} onSubmit={saveDocumentEdit} submitLabel="Salva modifiche" busy={savingDocumentEdit}>
      <label className="field"><span>Categoria</span><select name="category" defaultValue={editingDocument.category || "other"} required>{[["other","Altro"],["identity","Identificazione"],["origin","Provenienza"],["veterinary","Veterinario"],["legal","Documentazione legale"],["contract","Contratti"],["reproduction","Riproduzione"]].map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      <label className="field form-full"><span>Nota (facoltativa)</span><textarea name="note" rows={4} maxLength={10000} defaultValue={editingDocument.note || ""}/></label>
    </Dialog>}
  </div>;
}

export function PublicAnimalPage({ slug }: { slug: string }) {
  const [result, setResult] = useState<AnyRecord | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let current = true;
    setBusy(true);
    apiRequest("public/animals/" + encodeURIComponent(slug))
      .then(data => { if (current) setResult(data); })
      .catch(e => { if (current) setError(errorMessage(e) || "Profilo non disponibile."); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [slug]);
  const animal = result?.animal || {};
  const allowed = fields.filter(([key]) => Object.prototype.hasOwnProperty.call(animal, key));
  return <main className="public-profile-wrap"><section className="public-profile">
    <a className="brand" href="/" aria-label="Vivarqo"><span className="brand-mark">v</span><span>vivarqo<span className="brand-dot">.</span></span></a>
    {busy ? <p className="loading">Caricamento profilo pubblico…</p> : error || !result ? <div className="empty-state"><h1>Profilo non disponibile</h1><p>{error || "Questo link potrebbe essere stato revocato o non esistere."}</p></div> :
      <><p className="eyebrow">PROFILO ANIMALE CONDIVISO</p><h1>{animal.name || "Animale"}</h1><p className="public-species">{animal.species || ""}</p>{result.description && <p className="public-description">{result.description}</p>}<dl className="public-fields">{allowed.filter(([key]) => key !== "name" && key !== "species").map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{animal[key] ? (key === "birthDate" ? new Intl.DateTimeFormat("it-IT", { dateStyle: "long" }).format(new Date(animal[key])) : String(animal[key])) : "Non indicato"}</dd></div>)}</dl><p className="tiny">Questo profilo mostra esclusivamente i campi selezionati dall'allevatore per la condivisione pubblica.</p></>}
  </section></main>;
}