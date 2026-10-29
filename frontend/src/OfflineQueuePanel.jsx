import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api/api.js";
import { clearOfflineMutations, listOfflineMutations, removeOfflineMutation, updateOfflineMutation } from "./offlineQueue.js";

function Button({ children, variant = "secondary", ...props }) {
  return <button className={"button " + variant} {...props}>{children}</button>;
}
const statusLabel = status => status === "queued" ? "In attesa" : status === "syncing" ? "Invio in corso" : status === "failed" ? "Da correggere" : "Verifica richiesta";

export function OfflineQueuePanel({ owner, online, onNotice = () => {} }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState("");
  const running = useRef(false);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;

  const refresh = useCallback(async () => {
    if (!owner) { setItems([]); return; }
    try {
      const next = await listOfflineMutations(owner);
      setItems(next);
      setStorageError("");
    } catch (e) {
      setStorageError(e.message || "La coda offline non è accessibile in questo browser.");
    }
  }, [owner]);

  const syncQueued = useCallback(async ({ retryId = null, allowUncertain = false } = {}) => {
    if (!owner || !online || (typeof navigator !== "undefined" && navigator.onLine === false) || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await refresh();
      let current = await listOfflineMutations(owner);
      const ordered = current.filter(item => item.status === "queued" || item.id === retryId && (item.status === "failed" || item.status === "uncertain"));
      for (const item of ordered) {
        if (!navigator.onLine || ownerRef.current !== owner) break;
        if (item.status === "uncertain" && !allowUncertain) continue;
        await updateOfflineMutation(owner, item.id, { status: "syncing", error: null });
        try {
          await apiRequest(item.path, {
            method: item.method,
            body: item.body,
          });
          await removeOfflineMutation(owner, item.id);
        } catch (error) {
          const status = Number(error?.status || 0);
          const looksLikeServerResponse = status >= 400 && status < 500;
          if (looksLikeServerResponse) {
            await updateOfflineMutation(owner, item.id, {
              status: "failed",
              error: error.message || "Il server ha rifiutato questa modifica."
            });
          } else {
            await updateOfflineMutation(owner, item.id, {
              status: "uncertain",
              error: "Non è possibile sapere con certezza se il server abbia applicato la modifica. Verifica prima i dati, poi usa Riprova solo se necessario."
            });
            break;
          }
        }
      }
    } catch (error) {
      setStorageError(error.message || "Sincronizzazione non riuscita.");
    } finally {
      running.current = false;
      setBusy(false);
      await refresh();
    }
  }, [owner, online, refresh]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const changed = () => { void refresh(); };
    const networkOnline = () => { void refresh().then(() => syncQueued()); };
    window.addEventListener("vivarqo:offline-queue-changed", changed);
    window.addEventListener("online", networkOnline);
    return () => {
      window.removeEventListener("vivarqo:offline-queue-changed", changed);
      window.removeEventListener("online", networkOnline);
    };
  }, [refresh, syncQueued]);
  useEffect(() => {
    if (online && items.some(item => item.status === "queued")) void syncQueued();
  }, [online, items, syncQueued]);

  const retry = async item => {
    if (!online) { onNotice("Torna online prima di sincronizzare le modifiche.", "warning"); return; }
    let allowUncertain = false;
    if (item.status === "uncertain") {
      if (!window.confirm("Questa richiesta potrebbe essere già stata applicata al server. Controlla prima lo storico dell'account: riprovare può creare un duplicato. Vuoi riprovare comunque?")) return;
      allowUncertain = true;
    }
    await syncQueued({ retryId: item.id, allowUncertain });
    onNotice("Controllo della modifica terminato. Verifica l'esito nella lista.", "info");
  };
  const discard = async item => {
    if (!window.confirm("Eliminare questa modifica in attesa? Non verrà inviata al server.")) return;
    try { await removeOfflineMutation(owner, item.id); onNotice("Modifica rimossa dalla coda."); }
    catch (e) { setStorageError(e.message); }
  };
  const clearQueue = async () => {
    if (!window.confirm("Rimuovere tutte le modifiche locali di questo account? Quelle non sincronizzate andranno perse.")) return;
    try { await clearOfflineMutations(owner); onNotice("Coda locale svuotata."); }
    catch (e) { setStorageError(e.message); }
  };

  if (!owner) return null;
  const pending = items.filter(item => item.status !== "synced");
  return <section className="offline-queue-panel" aria-label="Sincronizzazione offline">
    <div className="offline-queue-summary">
      <div>
        <strong>{pending.length ? pending.length + " modifiche locali" : "Nessuna modifica in coda"}</strong>
        <p>{!online ? "Offline: le modifiche compatibili restano su questo dispositivo." : busy ? "Sincronizzazione in corso…" : "La sincronizzazione automatica si avvia quando il dispositivo è online e Vivarqo è aperto."}</p>
      </div>
      <div className="inline-actions">
        <Button onClick={() => setOpen(value => !value)}>{open ? "Nascondi dettagli" : "Dettagli"}</Button>
        <Button disabled={!online || busy || !pending.some(item => item.status === "queued")} onClick={() => syncQueued()}>Sincronizza</Button>
      </div>
    </div>
    {storageError && <p className="form-message" role="alert">{storageError}</p>}
    {open && <>
      <p className="muted offline-privacy-warning">La coda è salvata in IndexedDB sul dispositivo e non è cifrata dall'app. Su un dispositivo condiviso esci dall'account e cancella la coda dopo aver sincronizzato. Le risposte private dell'API e gli allegati non sono conservati nella cache del service worker.</p>
      {pending.length === 0 ? <p className="muted">Non ci sono modifiche locali da inviare.</p> : <div className="queue-list">{pending.map(item => <article className="queue-row" key={item.id}>
        <div><strong>{item.label}</strong><small>{new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))} · {statusLabel(item.status)}</small>{item.error && <p className="form-message">{item.error}</p>}</div>
        <div className="inline-actions">{(item.status === "failed" || item.status === "uncertain") && <Button disabled={!online || busy} onClick={() => retry(item)}>Riprova</Button>}{item.status !== "syncing" && <Button variant="danger" disabled={busy} onClick={() => discard(item)}>Rimuovi</Button>}</div>
      </article>)}</div>}
      {pending.length > 0 && <div className="inline-actions queue-clear"><Button variant="danger" disabled={busy} onClick={clearQueue}>Svuota tutta la coda</Button></div>}
    </>}
  </section>;
}