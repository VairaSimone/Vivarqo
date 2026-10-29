import React, { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api/api.js";

const arrayOf = value => Array.isArray(value) ? value : [];
const sexOptions = [["unknown", "Non specificato"], ["female", "Femmina"], ["male", "Maschio"]];
const dateLabel = value => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value)) : "—";
function Button({ children, variant = "secondary", ...props }) { return <button className={"button " + variant} {...props}>{children}</button>; }
function Input({ label, name, type = "text", defaultValue = "", required = false, ...props }) { return <label className="field"><span>{label}</span><input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} {...props}/></label>; }
function Select({ label, name, defaultValue = "unknown", options }) { return <label className="field"><span>{label}</span><select name={name} defaultValue={defaultValue}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>; }
const cleanAnimal = raw => ({
  name: String(raw.name || "").trim(),
  identifier: String(raw.identifier || "").trim() || null,
  species: String(raw.species || "").trim(),
  sex: raw.sex || "unknown",
  morph: String(raw.morph || "").trim() || null,
  birthDate: raw.birthDate || null,
  locationLabel: String(raw.locationLabel || "").trim() || null,
  notes: String(raw.notes || "").trim() || null
});
const emptyBulkRow = () => ({ name: "", identifier: "", species: "", sex: "unknown", morph: "", birthDate: "", locationLabel: "" });

export function AnimalsHub({ owner, onNotice = () => {} }) {
  const [animals, setAnimals] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("active");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState([emptyBulkRow()]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50", status });
      if (query.trim()) params.set("q", query.trim());
      const response = await apiRequest("animals?" + params.toString());
      setAnimals(arrayOf(response.animals));
      setPagination(response.pagination || { page, pageSize: 50, total: arrayOf(response.animals).length, totalPages: 1 });
    } catch (err) {
      setError(err.message || "Impossibile caricare gli animali.");
    } finally { setBusy(false); }
  }, [page, query, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const changed = () => { void load(); };
    window.addEventListener("vivarqo:offline-queue-changed", changed);
    return () => window.removeEventListener("vivarqo:offline-queue-changed", changed);
  }, [load]);

  const run = async (label, operation) => {
    setSaving(true);
    try {
      await operation();
      onNotice(label, "success");
      setEditor(null); setBulkOpen(false);
      await load();
    } catch (err) { onNotice(err.message || "Operazione non riuscita.", "error"); }
    finally { setSaving(false); }
  };
  const submitEditor = event => {
    event.preventDefault();
    const body = cleanAnimal(Object.fromEntries(new FormData(event.currentTarget).entries()));
    if (!body.name || !body.species) return onNotice("Nome e specie sono obbligatori.", "error");
    const current = editor?.animal;
    void run(current ? "Scheda animale aggiornata." : "Animale creato.", () =>
      apiRequest(current ? "animals/" + current.id : "animals", { method: current ? "PATCH" : "POST", body })
    );
  };
  const submitBulk = event => {
    event.preventDefault();
    const animalsToCreate = bulkRows.filter(row => row.name.trim() || row.species.trim()).map(cleanAnimal);
    if (!animalsToCreate.length) return onNotice("Inserisci almeno un animale.", "error");
    const invalid = animalsToCreate.findIndex(animal => !animal.name || !animal.species);
    if (invalid >= 0) return onNotice("Ogni riga compilata deve avere nome e specie.", "error");
    const ids = animalsToCreate.map(animal => animal.identifier?.toLocaleLowerCase("it-IT")).filter(Boolean);
    if (new Set(ids).size !== ids.length) return onNotice("Ci sono identificativi duplicati nel gruppo.", "error");
    void run(animalsToCreate.length + " animali creati.", () =>
      apiRequest("animals/bulk", { method: "POST", body: { animals: animalsToCreate } })
    );
  };
  const archive = animal => {
    if (!window.confirm("Archiviare " + animal.name + "? La scheda non verrà eliminata.")) return;
    void run("Animale archiviato.", () => apiRequest("animals/" + animal.id + "/archive", { method: "POST", body: {} }));
  };
  const restore = animal => {
    if (!window.confirm("Ripristinare " + animal.name + "?")) return;
    void run("Animale ripristinato.", () => apiRequest("animals/" + animal.id + "/restore", { method: "POST", body: {} }));
  };
  const remove = animal => {
    if (!window.confirm("Eliminare definitivamente " + animal.name + "? Se ha registri collegati il backend impedirà la cancellazione.")) return;
    void run("Animale eliminato.", () => apiRequest("animals/" + animal.id, { method: "DELETE" }));
  };
  const changeStatus = next => { setStatus(next); setPage(1); };
  const changeQuery = next => { setQuery(next); setPage(1); };

  return <div className="advanced-stack">
    <section className="panel records-panel">
      <div className="panel-heading"><div><p className="eyebrow">ANAGRAFICA</p><h2>Animali</h2><p className="subheading">Cerca, modifica, archivia o ripristina le schede. Le liste sono paginate dal server.</p></div><div className="inline-actions"><Button onClick={() => { setEditor({ animal: null }); setBulkOpen(false); }}>＋ Nuovo animale</Button><Button variant="primary" onClick={() => { setBulkOpen(v => !v); setEditor(null); }}>＋ Crea in blocco</Button></div></div>
      <div className="record-tools inline-actions">
        <label className="field"><span>Stato schede</span><select value={status} onChange={e => changeStatus(e.target.value)}><option value="active">Attivi</option><option value="archived">Archiviati</option><option value="all">Tutti gli stati</option></select></label>
        <label className="field"><span>Cerca per nome o identificativo</span><input type="search" value={query} onChange={e => changeQuery(e.target.value)} placeholder="Nome o codice…"/></label>
        <Button onClick={() => void load()}>↻ Aggiorna</Button>
      </div>
      {error && <p className="form-message" role="alert">{error}</p>}
      {editor && <div className="embedded-form"><form className="form-grid" onSubmit={submitEditor} key={editor.animal?.id || "new-animal"}>
        <h3 className="form-full">{editor.animal ? "Modifica scheda" : "Nuova scheda animale"}</h3>
        <Input label="Nome" name="name" defaultValue={editor.animal?.name} required maxLength="120"/>
        <Input label="Specie" name="species" defaultValue={editor.animal?.species} required maxLength="160"/>
        <Input label="Identificativo" name="identifier" defaultValue={editor.animal?.identifier} maxLength="120"/>
        <Select label="Sesso" name="sex" defaultValue={editor.animal?.sex || "unknown"} options={sexOptions}/>
        <Input label="Morph" name="morph" defaultValue={editor.animal?.morph} maxLength="200"/>
        <Input label="Data di nascita" name="birthDate" type="date" defaultValue={editor.animal?.birthDate ? String(editor.animal.birthDate).slice(0, 10) : ""}/>
        <Input label="Stabulazione / posizione" name="locationLabel" defaultValue={editor.animal?.locationLabel} maxLength="160"/>
        <label className="field form-full"><span>Note</span><textarea name="notes" defaultValue={editor.animal?.notes || ""} rows="3" maxLength="10000"/></label>
        <div className="form-actions form-full"><Button type="button" onClick={() => setEditor(null)}>Annulla</Button><Button variant="primary" disabled={saving}>{saving ? "Salvataggio…" : "Salva scheda"}</Button></div>
      </form></div>}
      {bulkOpen && <div className="embedded-form"><form onSubmit={submitBulk}>
        <div className="panel-heading"><div><h3>Crea più animali</h3><p className="subheading">Ogni riga diventa una scheda. Nome e specie sono obbligatori; gli identificativi devono essere univoci.</p></div><Button type="button" onClick={() => setBulkRows(rows => rows.length < 500 ? [...rows, emptyBulkRow()] : rows)} disabled={bulkRows.length >= 500}>＋ Riga</Button></div>
        <div className="table-wrap"><table><thead><tr><th>Nome *</th><th>Specie *</th><th>Identificativo</th><th>Sesso</th><th>Morph</th><th>Data nascita</th><th>Posizione</th><th></th></tr></thead><tbody>
          {bulkRows.map((row, index) => <tr key={index}>
            {["name", "species", "identifier"].map(name => <td key={name}><input className="compact-input" aria-label={name} value={row[name]} required={name !== "identifier" && Boolean(row.name || row.species || row.identifier)} onChange={e => setBulkRows(rows => rows.map((item, i) => i === index ? { ...item, [name]: e.target.value } : item))}/></td>)}
            <td><select className="compact-input" value={row.sex} onChange={e => setBulkRows(rows => rows.map((item, i) => i === index ? { ...item, sex: e.target.value } : item))}>{sexOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></td>
            {["morph", "birthDate", "locationLabel"].map(name => <td key={name}><input className="compact-input" type={name === "birthDate" ? "date" : "text"} aria-label={name} value={row[name]} onChange={e => setBulkRows(rows => rows.map((item, i) => i === index ? { ...item, [name]: e.target.value } : item))}/></td>)}
            <td><Button type="button" variant="danger" onClick={() => setBulkRows(rows => rows.length > 1 ? rows.filter((_, i) => i !== index) : [emptyBulkRow()])}>Rimuovi</Button></td>
          </tr>)}
        </tbody></table></div>
        <div className="form-actions"><Button type="button" onClick={() => setBulkOpen(false)}>Annulla</Button><Button variant="primary" disabled={saving}>{saving ? "Creazione…" : "Crea " + bulkRows.length + " righe"}</Button></div>
      </form></div>}
      {busy ? <div className="loading">Caricamento animali…</div> : animals.length === 0 ? <div className="empty-state"><h3>Nessun animale in questa vista</h3><p>Crea una scheda oppure modifica il filtro di stato.</p></div> :
      <div className="table-wrap"><table><thead><tr><th>Nome</th><th>Identificativo</th><th>Specie</th><th>Sesso</th><th>Morph</th><th>Data nascita</th><th>Posizione</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>{animals.map(animal => <tr key={animal.id}>
        <td>{animal.name}</td><td>{animal.identifier || "—"}</td><td>{animal.species}</td><td>{animal.sex || "unknown"}</td><td>{animal.morph || "—"}</td><td>{dateLabel(animal.birthDate)}</td><td>{animal.locationLabel || "—"}</td><td>{animal.status || "active"}</td>
        <td><div className="inline-actions"><Button onClick={() => { setEditor({ animal }); setBulkOpen(false); }}>Modifica</Button>{animal.status === "archived" ? <Button variant="primary" onClick={() => restore(animal)}>Ripristina</Button> : <Button onClick={() => archive(animal)}>Archivia</Button>}<Button variant="danger" onClick={() => remove(animal)}>Elimina</Button></div></td>
      </tr>)}</tbody></table></div>}
      <div className="pagination-bar"><span className="muted">Pagina {pagination.page || page} di {Math.max(1, pagination.totalPages || 1)} · {pagination.total ?? animals.length} animali</span><div className="inline-actions"><Button disabled={page <= 1 || busy} onClick={() => setPage(p => Math.max(1, p - 1))}>← Precedente</Button><Button disabled={page >= (pagination.totalPages || 1) || busy} onClick={() => setPage(p => p + 1)}>Successiva →</Button></div></div>
    </section>
  </div>;
}
