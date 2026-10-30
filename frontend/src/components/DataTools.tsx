import React, { useEffect, useState } from "react";
import type { NoticeHandler } from "../types";
import { Button, Field, SelectField } from "../ui/FormControls";
import { apiRequest, apiUpload } from "../api/api";
import { useConfirmDialog } from "../ui/ConfirmDialog";

const date = value => { if (!value) return "—"; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(parsed); };

export function DataTools({onNotice}: { onNotice: NoticeHandler }) {
  const confirmAction = useConfirmDialog();
  const [file, setFile] = useState(null);
  const [entity, setEntity] = useState("animals");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [includeDocs, setIncludeDocs] = useState(false);
  const [exportJob, setExportJob] = useState(null);
  const [importJob, setImportJob] = useState(null);
  const entities = [["animals","Animali"],["weights","Pesate"],["sheds","Mute"],["notes","Note"],["feedings","Alimentazioni"],["finance","Finanze"],["inventory","Inventario"],["reproductionCycles","Cicli riproduttivi"],["reproductiveEvents","Eventi riproduttivi"],["clutches","Covate"],["eggs","Uova"],["incubationLogs","Controlli d’incubazione"],["offspringBatches","Lotti di piccoli"]];
  const upload = async e => {
    e.preventDefault();
    if (!file) return onNotice("Scegli prima un file CSV o XLSX.", "error");
    setBusy(true);
    try {
      const result = await apiUpload("imports?entity=" + encodeURIComponent(entity), file);
      setPreview(result);
      onNotice("Anteprima pronta: nessun dato importato ancora.");
    } catch (error) { onNotice(error.message, "error"); }
    finally { setBusy(false); }
  };
  const downloadWhenReady = async id => {
    setBusy(true);
    try {
      const result = await apiRequest("exports/" + encodeURIComponent(id));
      setExportJob({ ...result.export, ready: result.ready });
      if (result.ready) window.location.assign("/api/v1/exports/" + encodeURIComponent(id) + "/download");
      else onNotice("L'esportazione non è ancora pronta. Verifica nuovamente lo stato tra poco.", "warning");
    } catch (error) { onNotice(error.message, "error"); }
    finally { setBusy(false); }
  };
  const exportData = async () => {
    setBusy(true);
    try {
      const result = await apiRequest("exports", { method: "POST", body: { includeDocuments: includeDocs } });
      const id = result?.export?.id;
      if (!id) throw new Error("Il server non ha restituito l'identificativo dell'esportazione.");
      setExportJob({ ...result.export, ready: false });
      onNotice("Esportazione accodata. La generazione prosegue in background.");
    } catch (error) { onNotice(error.message, "error"); }
    finally { setBusy(false); }
  };
  const confirmImport = async () => {
    if (!preview) return;
    const possibleDuplicates = Array.isArray(preview.possibleDuplicates) ? preview.possibleDuplicates : [];
    let body = {};
    if (entity === "animals" && possibleDuplicates.length > 0) {
      const accepted = await confirmAction({title:"Possibili duplicati",message:"L’anteprima segnala "+possibleDuplicates.length+" possibili duplicati per nome e specie. Gli identificativi già esistenti saranno comunque verificati dal server.",confirmLabel:"Procedi con l’importazione",danger:true});
      if (!accepted) return;
      body = { allowPossibleDuplicates: true };
    }
    setBusy(true);
    try {
      const id = preview.importId || preview.id || preview.import?.id;
      if (!id) throw new Error("L'anteprima non contiene un identificativo d'importazione valido.");
      const result = await apiRequest("imports/" + encodeURIComponent(id) + "/confirm", { method: "POST", body });
      setPreview(null);
      setImportJob({ id, status: result.status || "queued", createdCount: 0, errorCount: result.errorCount || 0 });
      onNotice("Importazione accodata. L'elaborazione prosegue in background.");
    } catch (error) { onNotice(error.message, "error"); }
    finally { setBusy(false); }
  };
  const statusLabel = status => ({ pending: "In attesa", queued: "In coda", processing: "In elaborazione", completed: "Completata", failed: "Non riuscita", expired: "Scaduta" }[status] || status || "Sconosciuto");

  useEffect(() => {
    if (!importJob?.id || ["completed", "failed", "expired"].includes(importJob.status)) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const result = await apiRequest("imports/" + encodeURIComponent(importJob.id) + "?statusOnly=true");
        if (!active || !result?.status) return;
        setImportJob({ ...result, id: importJob.id });
        if (result.status === "completed") onNotice("Importazione completata: " + (result.createdCount ?? 0) + " record importati.", "success");
        if (result.status === "failed") onNotice("Importazione non riuscita. Codice: " + (result.lastErrorCode || "IMPORT_PROCESSING_FAILED"), "error");
      } catch {
        // A transient status-read failure does not stop the server-side job.
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [importJob?.id, importJob?.status, onNotice]);

  useEffect(() => {
    if (!exportJob?.id || ["completed", "failed", "expired"].includes(exportJob.status)) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const result = await apiRequest("exports/" + encodeURIComponent(exportJob.id));
        if (!active || !result?.export) return;
        setExportJob({ ...result.export, ready: result.ready });
        if (result.export.status === "failed") onNotice("Esportazione non riuscita. Codice: " + (result.export.lastErrorCode || "EXPORT_PROCESSING_FAILED"), "error");
      } catch {
        // A transient status-read failure is retried on the next poll.
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [exportJob?.id, exportJob?.status, onNotice]);
  return <div className="transfer-grid">
    <section className="panel">
      <p className="eyebrow">IMPORT GUIDATO</p><h2>Importa dati esistenti</h2>
      <p>Carica CSV o XLSX. Prima di confermare controlla l'anteprima e gli eventuali errori.</p>
      <form className="form-stack" onSubmit={upload}>
        <SelectField label="Tipo di dati" value={entity} onChange={e => { setEntity(e.target.value); setPreview(null); }}>
          {entities.map(([id,label]) => <option key={id} value={id}>{label}</option>)}
        </SelectField>
        <Field label="File CSV o XLSX" type="file" accept=".csv,.xlsx" onChange={e => setFile(e.target.files?.[0] || null)} required/>
        <Button disabled={busy}>{busy ? "Elaborazione…" : "Crea anteprima"}</Button>
      </form>
      {importJob && <div className="import-result">
        <p>Stato importazione: <strong>{statusLabel(importJob.status)}</strong>
          {importJob.status === "completed" ? " · Record creati: " + (importJob.createdCount ?? 0) : ""}
          {importJob.status === "failed" ? " · " + (importJob.lastErrorCode || "Errore durante l'elaborazione") : ""}
        </p>
        {["queued", "processing"].includes(importJob.status) && <p className="muted">Puoi continuare a usare Vivarqo: il server sta elaborando il file.</p>}
      </div>}
      {preview && <div className="import-result">
        <h3>Anteprima importazione</h3>
        <p>Righe totali: {preview.totalRows ?? "—"} · valide: {preview.validRows ?? "—"} · errori: {preview.invalidRows ?? "—"}</p>
        {entity === "animals" && Array.isArray(preview.possibleDuplicates) && preview.possibleDuplicates.length > 0 && <div className="notice warning"><strong>Possibili duplicati rilevati ({preview.possibleDuplicates.length}).</strong><p>Controlla le righe segnalate: la conferma richiederà un'ulteriore autorizzazione esplicita.</p></div>}
        {(preview.errors || []).slice(0,20).map((error, index) => <p key={index} className="error-text">Riga {error.row}: {error.column} — {error.reason}</p>)}
        <Button onClick={confirmImport} disabled={busy || !preview.validRows}>Conferma importazione</Button>
      </div>}
    </section>
    <section className="panel">
      <p className="eyebrow">PORTABILITÀ</p><h2>Esporta il tuo account</h2>
      <p>Genera un archivio privato con identificativi e relazioni. Gli archivi possono contenere dati personali.</p>
      <label className="check-row"><input type="checkbox" checked={includeDocs} onChange={e => setIncludeDocs(e.target.checked)}/> Includi documenti e allegati</label>
      <Button onClick={exportData} disabled={busy}>Genera e scarica archivio ZIP</Button>
      {exportJob && <div className="import-result">
        <p>Stato esportazione: <strong>{statusLabel(exportJob.status)}</strong>{exportJob.expiresAt ? " · Scadenza: " + date(exportJob.expiresAt) : ""}</p>
        <Button onClick={() => void downloadWhenReady(exportJob.id)} disabled={busy || exportJob.status === "failed"}>{exportJob.ready ? "Scarica archivio ZIP" : "Verifica stato"}</Button>
        {exportJob.status === "failed" && <p className="error-text">Esportazione non riuscita: {exportJob.lastErrorCode || "errore interno"}.</p>}
      </div>}
      <p className="muted">Lo stato viene verificato con il backend prima di iniziare il download.</p>
    </section>
  </div>;
}
