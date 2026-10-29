import React, { useState } from "react";
import { apiRequest, apiUpload } from "../api/api.js";
import { useConfirmDialog } from "../ui/ConfirmDialog.jsx";

function Button({ children, variant = "", ...props }) { return <button className={"button " + variant} {...props}>{children}</button>; }
function Field({ label, ...props }) { return <label className="field"><span>{label}</span><input {...props}/></label>; }
function SelectField({ label, children, ...props }) { return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>; }
const date = value => { if (!value) return "—"; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(parsed); };

export function DataTools({onNotice}) {
  const confirmAction = useConfirmDialog();
  const [file, setFile] = useState(null);
  const [entity, setEntity] = useState("animals");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [includeDocs, setIncludeDocs] = useState(false);
  const [exportJob, setExportJob] = useState(null);
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
      const status = await apiRequest("exports/" + encodeURIComponent(id));
      setExportJob({ ...status.export, ready: status.ready });
      if (status.ready) window.location.assign("/api/v1/exports/" + encodeURIComponent(id) + "/download");
      else onNotice("L'esportazione non è ancora pronta. Verifica nuovamente lo stato tra poco.", "warning");
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
      await apiRequest("imports/" + id + "/confirm", { method: "POST", body });
      setPreview(null);
      onNotice("Importazione completata.");
    } catch (error) { onNotice(error.message, "error"); }
    finally { setBusy(false); }
  };
  const statusLabel = status => ({ pending: "In attesa", processing: "In elaborazione", completed: "Completata", failed: "Non riuscita" }[status] || status || "Sconosciuto");
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
        <Button onClick={() => void downloadWhenReady(exportJob.id)} disabled={busy}>Verifica stato / scarica archivio</Button>
      </div>}
      <p className="muted">Lo stato viene verificato con il backend prima di iniziare il download.</p>
    </section>
  </div>;
}
