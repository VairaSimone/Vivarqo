import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { Alert, Button, Field, Input, Panel, PanelHeader, Select, Textarea, useToast } from "../../components/ui";
import type { Locale } from "../../lib/domain";
import { getLocationDescendantIds, getLocationPath } from "./location-tree";

type Location = { id: string; name: string; kind: "room" | "rack" | "shelf" | "container"; parentId: string | null; sortOrder: number; _count?: { animals: number; children: number } };
type Animal = { id: string; name: string; species: string; identifier?: string | null; locationId?: string | null; status: string };
const labels = { room: "Stanza", rack: "Rack", shelf: "Ripiano", container: "Contenitore" } as const;

export function AnimalManagementPanel({ locale }: { locale: Locale }) {
  const it = locale === "it";
  const [locations, setLocations] = useState<Location[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<Location["kind"]>("room");
  const [parentId, setParentId] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [filter, setFilter] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast, show } = useToast();

  async function reload() {
    const [l, a] = await Promise.all([
      api.get<{ locations: Location[] }>("/animals/locations"),
      api.get<{ animals: Animal[]; pagination?: { totalPages: number } }>("/animals?page=1&pageSize=100&status=active")
    ]);
    const allAnimals = [...a.animals];
    for (let page = 2; page <= (a.pagination?.totalPages ?? 1); page++) {
      const next = await api.get<{ animals: Animal[] }>("/animals?page=" + page + "&pageSize=100&status=active");
      allAnimals.push(...next.animals);
    }
    setLocations(l.locations);
    setAnimals(allAnimals);
  }
  useEffect(() => { void reload().catch((e) => setError(e instanceof ApiError ? e.message : "Unable to load animal locations")); }, []);
  const pathOf = (id: string | null | undefined): string => getLocationPath(locations, id, it ? "Non assegnato" : "Unassigned");
  const descendants = (id: string): string[] => getLocationDescendantIds(locations, id);
  const visibleAnimals = animals.filter((a) => !filter || descendants(filter).includes(a.locationId ?? ""));
  const parents = locations.filter((l) => l.kind === ({ room: "room", rack: "room", shelf: "rack", container: "shelf" } as const)[kind]);
  const eligibleParents = kind === "room" ? [] : parents;

  async function saveLocation() {
    setBusy(true); setError("");
    try {
      if (editing) await api.patch("/animals/locations/" + editing, { name: name.trim() });
      else await api.post("/animals/locations", { kind, name: name.trim(), parentId: parentId || null, sortOrder: 0 });
      setName(""); setParentId(""); setEditing(null); await reload();
      show(it ? "Posizione salvata." : "Location saved.");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Operation failed"); }
    finally { setBusy(false); }
  }
  async function deleteLocation(location: Location) {
    if (!window.confirm(it ? "Eliminare questa posizione? Deve essere vuota e senza sottoposizioni." : "Delete this location? It must be empty.")) return;
    try { await api.delete("/animals/locations/" + location.id); await reload(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Delete failed"); }
  }
  async function moveAnimals() {
    if (!selected.length) return;
    setBusy(true); setError("");
    try {
      await api.post("/animals/move", { animalIds: selected, toLocationId: destination || null, reason: reason.trim() || null });
      setSelected([]); setReason(""); await reload();
      show(it ? selected.length + " animali spostati." : selected.length + " animals moved.");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Move failed"); }
    finally { setBusy(false); }
  }
  const locationOptions = locations.map((l) => ({ id: l.id, label: pathOf(l.id) }));
  return <Panel>
    <PanelHeader title={it ? "Posizioni e movimentazione" : "Locations and animal moves"} description={it ? "Organizza stanza → rack → ripiano → contenitore e sposta più esemplari in un'unica operazione." : "Organize room → rack → shelf → container and move multiple animals at once."} />
    {error && <Alert tone="danger">{error}</Alert>}
    <div className="form-grid">
      <Field label={it ? "Livello" : "Level"}><Select value={kind} onChange={(e) => { setKind(e.target.value as Location["kind"]); setParentId(""); }}><option value="room">Stanza</option><option value="rack">Rack</option><option value="shelf">Ripiano</option><option value="container">Contenitore</option></Select></Field>
      {kind !== "room" && <Field label={it ? "Posizione superiore" : "Parent location"}><Select value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">—</option>{eligibleParents.map((l) => <option key={l.id} value={l.id}>{pathOf(l.id)}</option>)}</Select></Field>}
      <Field label={it ? "Nome posizione" : "Location name"}><Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={it ? "Es. Rack 1" : "e.g. Rack 1"} /></Field>
      <div className="inline-actions" style={{ alignItems: "end" }}><Button disabled={busy || !name.trim() || (kind !== "room" && !parentId)} onClick={() => void saveLocation()}>{editing ? (it ? "Aggiorna" : "Update") : (it ? "Crea posizione" : "Create location")}</Button>{editing && <Button variant="secondary" onClick={() => { setEditing(null); setName(""); }}> {it ? "Annulla" : "Cancel"}</Button>}</div>
    </div>
    <div className="record-list" style={{ marginTop: 14 }}>{locations.map((l) => <div className="record-row" key={l.id}><div><strong>{labels[l.kind]} · {l.name}</strong><small>{pathOf(l.id)} · {l._count?.animals ?? 0} {it ? "animali" : "animals"} · {l._count?.children ?? 0} {it ? "figli" : "children"}</small></div><div className="row-actions"><Button size="sm" variant="secondary" onClick={() => { setEditing(l.id); setName(l.name); }}>{it ? "Modifica" : "Edit"}</Button><Button size="sm" variant="danger" onClick={() => void deleteLocation(l)}>{it ? "Elimina" : "Delete"}</Button></div></div>)}</div>
    <div className="divider" />
    <PanelHeader title={it ? "Spostamento multiplo" : "Bulk move"} description={it ? "Seleziona gli animali, filtra per posizione e scegli la destinazione." : "Select animals, filter by current location and choose a destination."} />
    <div className="form-grid">
      <Field label={it ? "Filtra per posizione (include discendenti)" : "Filter by location (includes descendants)"}><Select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">{it ? "Tutte le posizioni" : "All locations"}</option>{locationOptions.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
      <Field label={it ? "Destinazione" : "Destination"}><Select value={destination} onChange={(e) => setDestination(e.target.value)}><option value="">{it ? "Senza posizione" : "Unassigned"}</option>{locationOptions.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
      <Field label={it ? "Motivo (facoltativo)" : "Reason (optional)"}><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
    </div>
    <div className="inline-actions" style={{ justifyContent: "space-between", margin: "12px 0" }}><label className="checkbox-field"><input type="checkbox" checked={visibleAnimals.length > 0 && visibleAnimals.every((a) => selected.includes(a.id))} onChange={(e) => setSelected(e.target.checked ? Array.from(new Set([...selected, ...visibleAnimals.map((a) => a.id)])) : selected.filter((id) => !visibleAnimals.some((a) => a.id === id)))} />{it ? "Seleziona tutti i risultati" : "Select all results"} ({visibleAnimals.length})</label><Button disabled={!selected.length || busy} onClick={() => void moveAnimals()}>{it ? `Sposta ${selected.length} selezionati` : `Move ${selected.length} selected`}</Button></div>
    <div className="record-list">{visibleAnimals.map((a) => <label className="record-row" key={a.id} style={{ cursor: "pointer" }}><span style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={selected.includes(a.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, a.id] : selected.filter((id) => id !== a.id))} /><span><strong>{a.name}</strong><small>{a.identifier || a.species} · {pathOf(a.locationId)}</small></span></span></label>)}</div>
    {toast}
  </Panel>;
}
