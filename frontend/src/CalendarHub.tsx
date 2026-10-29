import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/api.js";
import { Icon } from "./ui/Icon.tsx";
import { useConfirmDialog } from "./ui/ConfirmDialog.tsx";

const CATEGORIES = [["feeding", "Alimentazione"], ["weighing", "Peso"], ["shed_check", "Muta"], ["cleaning", "Pulizia"], ["reproduction", "Riproduzione"], ["document", "Documenti"], ["inventory", "Inventario"], ["custom", "Altro"]];
const pad = value => String(value).padStart(2, "0");
const dateKey = date => date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
const toDate = value => new Date(value + "T00:00:00");
const dateLabel = value => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const dtInput = value => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
};
const mondayOf = date => { const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate()); copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7)); return copy; };
const dateRange = (anchor, view) => {
  let from, to;
  if (view === "week") { from = mondayOf(anchor); to = new Date(from); to.setDate(to.getDate() + 6); }
  else if (view === "list") { from = new Date(anchor.getFullYear(), anchor.getMonth(), 1); to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0); }
  else { from = new Date(anchor.getFullYear(), anchor.getMonth(), 1); to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0); }
  return { from: dateKey(from), to: dateKey(to) };
};
function Button({ children, variant = "secondary", ...props }) { return <button className={"button " + variant} {...props}>{children}</button>; }
function Field({ label, name, type = "text", defaultValue = "", required = false, ...props }) { return <label className="field"><span>{label}</span><input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} {...props}/></label>; }
function Select({ label, name, defaultValue, options, ...props }) { return <label className="field"><span>{label}</span><select name={name} defaultValue={defaultValue ?? options[0][0]} {...props}>{options.map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></label>; }

export function CalendarHub({ onNotice = () => {} }) {
  const confirmAction = useConfirmDialog();
  const [view, setView] = useState(() => window.matchMedia?.("(max-width: 760px)").matches ? "list" : "month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [items, setItems] = useState([]);
  const [rules, setRules] = useState([]);
  const [rulePagination, setRulePagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [rulePage, setRulePage] = useState(1);
  const [animals, setAnimals] = useState([]);
  const [animalsPage, setAnimalsPage] = useState(1);
  const [animalsPagination, setAnimalsPagination] = useState({ page: 1, pageSize: 100, total: 0, totalPages: 1 });
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskEditing, setTaskEditing] = useState(null);
  const [ruleForm, setRuleForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const range = useMemo(() => dateRange(anchor, view), [anchor, view]);

  const loadCalendar = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ ...range, view, includeDismissed: String(includeDismissed) });
      const response = await apiRequest("calendar?" + params.toString());
      setItems(Array.isArray(response.items) ? response.items : []);
    } catch (err) { setError(err.message || "Impossibile caricare il calendario."); }
    finally { setBusy(false); }
  }, [range, view, includeDismissed]);
  const loadRules = useCallback(async () => {
    try {
      const [rulesResponse, animalResponse] = await Promise.all([
        apiRequest("tasks/reminder-rules?page=" + rulePage + "&pageSize=50&enabled=all"),
        apiRequest("animals?page=" + animalsPage + "&pageSize=100&status=active")
      ]);
      setRules(Array.isArray(rulesResponse.reminderRules) ? rulesResponse.reminderRules : []);
      setRulePagination(rulesResponse.pagination || { page: rulePage, pageSize: 50, total: 0, totalPages: 0 });
      const nextAnimals = Array.isArray(animalResponse.animals) ? animalResponse.animals : [];
      setAnimals(previous => Array.from(new Map([...previous, ...nextAnimals].map(animal => [animal.id, animal])).values()));
      setAnimalsPagination(animalResponse.pagination || { page: animalsPage, pageSize: 100, total: nextAnimals.length, totalPages: 1 });
    } catch (err) { setError(err.message || "Impossibile caricare i promemoria."); }
  }, [rulePage, animalsPage]);
  useEffect(() => { void loadCalendar(); }, [loadCalendar]);
  useEffect(() => { void loadRules(); }, [loadRules]);
  useEffect(() => {
    const match = window.location.pathname.match(/^\/tasks\/([0-9a-f-]{36})\/?$/i);
    if (!match) return;
    apiRequest("tasks/" + match[1]).then(result => { setTaskEditing(result.task || result); setTaskFormOpen(true); }).catch(() => {});
  }, []);

  const move = direction => {
    setAnchor(current => {
      const next = new Date(current);
      if (view === "week") next.setDate(next.getDate() + direction * 7);
      else next.setMonth(next.getMonth() + direction);
      return next;
    });
  };
  const title = view === "week"
    ? new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" }).format(toDate(range.from)) + " – " + new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" }).format(toDate(range.to))
    : new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(anchor);
  const saveTask = async event => {
    event.preventDefault();
    const v = Object.fromEntries(new FormData(event.currentTarget).entries());
    const body = { title: v.title.trim(), category: v.category, dueAt: new Date(v.dueAt).toISOString(), description: v.description.trim() || null, animalId: v.animalId || null };
    setSaving(true);
    try {
      await apiRequest(taskEditing ? "tasks/" + taskEditing.id : "tasks", { method: taskEditing ? "PATCH" : "POST", body });
      setTaskFormOpen(false); setTaskEditing(null); onNotice(taskEditing ? "Attività aggiornata." : "Attività creata.", "success");
      await loadCalendar();
    } catch (err) { onNotice(err.message || "Salvataggio attività non riuscito.", "error"); }
    finally { setSaving(false); }
  };
  const completeTask = async item => {
    try { await apiRequest("tasks/" + item.id + "/complete", { method: "POST", body: {} }); onNotice("Attività completata.", "success"); await loadCalendar(); }
    catch (err) { onNotice(err.message || "Impossibile completare l’attività.", "error"); }
  };
  const deleteTask = async item => {
    if (!(await confirmAction({ title: "Eliminare l’attività?", message: "“" + item.title + "” verrà eliminata definitivamente.", confirmLabel: "Elimina attività", danger: true }))) return;
    try { await apiRequest("tasks/" + item.id, { method: "DELETE" }); onNotice("Attività eliminata.", "success"); await loadCalendar(); }
    catch (err) { onNotice(err.message || "Impossibile eliminare l’attività.", "error"); }
  };
  const saveRule = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const v = Object.fromEntries(form.entries());
    const body = {
      title: v.title.trim(), category: v.category, intervalDays: Number(v.intervalDays),
      nextDueAt: new Date(v.nextDueAt).toISOString(), animalId: v.animalId || null,
      isEnabled: form.get("isEnabled") === "on"
    };
    setSaving(true);
    try {
      await apiRequest(ruleForm?.id ? "tasks/reminder-rules/" + ruleForm.id : "tasks/reminder-rules", {
        method: ruleForm?.id ? "PATCH" : "POST", body
      });
      setRuleForm(null); setRulePage(1);
      onNotice(ruleForm?.id ? "Promemoria ricorrente aggiornato." : "Promemoria ricorrente creato.", "success");
      await loadRules(); await loadCalendar();
    } catch (err) { onNotice(err.message || "Salvataggio promemoria non riuscito.", "error"); }
    finally { setSaving(false); }
  };
  const toggleRule = async rule => {
    try {
      await apiRequest("tasks/reminder-rules/" + rule.id, { method: "PATCH", body: { isEnabled: !rule.isEnabled } });
      onNotice(rule.isEnabled ? "Promemoria disattivato." : "Promemoria riattivato.", "success");
      await loadRules(); await loadCalendar();
    } catch (err) { onNotice(err.message || "Impossibile aggiornare il promemoria.", "error"); }
  };
  const deleteRule = async rule => {
    if (!(await confirmAction({ title: "Terminare il promemoria ricorrente?", message: "“" + rule.title + "” verrà disattivato e le attività aperte collegate saranno archiviate.", confirmLabel: "Termina promemoria", danger: true }))) return;
    try { await apiRequest("tasks/reminder-rules/" + rule.id, { method: "DELETE" }); onNotice("Promemoria disattivato.", "success"); await loadRules(); await loadCalendar(); }
    catch (err) { onNotice(err.message || "Impossibile disattivare il promemoria.", "error"); }
  };

  const byDay = useMemo(() => {
    const grouped = new Map();
    for (const item of items) {
      const key = dateKey(new Date(item.start));
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    }
    return grouped;
  }, [items]);
  const visibleDays = useMemo(() => {
    if (view === "week") {
      const from = toDate(range.from);
      return Array.from({ length: 7 }, (_, i) => { const d = new Date(from); d.setDate(d.getDate() + i); return d; });
    }
    if (view !== "month") return [];
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(first); d.setDate(d.getDate() + i - offset); return d;
    });
  }, [view, range.from, anchor]);
  const beginTask = item => {
    const record = item?.record;
    setTaskEditing(record && item.type === "task" ? record : null);
    setTaskFormOpen(true);
  };
  const monthNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const renderItem = item => <div className={"calendar-event event-" + item.type} key={item.type + "-" + item.id}>
    <strong>{item.title}</strong><small>{new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date(item.start))} · {item.animal?.name || (item.type === "reproduction" ? "Riproduzione" : item.type === "clutch" ? "Covata" : item.category)}</small>
    {item.type === "task" && <div className="inline-actions"><Button onClick={() => beginTask(item)}>Modifica</Button><Button onClick={() => void completeTask(item)}>Completa</Button><Button variant="danger" onClick={() => void deleteTask(item)}>Elimina</Button></div>}
    {item.type !== "task" && <span className="muted">{item.type === "reproduction" ? "Evento riproduttivo" : "Deposizione"}</span>}
  </div>;

  return <div className="advanced-stack">
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">PIANIFICAZIONE</p><h2>Calendario e attività</h2><p className="subheading">Scadenze, eventi riproduttivi e deposizioni letti dal backend.</p></div><div className="inline-actions"><Button variant="primary" onClick={() => beginTask(null)}>＋ Nuova attività</Button><Button onClick={() => void loadCalendar()} disabled={busy}><Icon name="refresh" size={16}/> Aggiorna</Button></div></div>
      <div className="calendar-toolbar"><div className="inline-actions"><Button onClick={() => move(-1)} aria-label="Periodo precedente"><Icon name="back" size={16}/></Button><Button onClick={() => setAnchor(new Date())}>Oggi</Button><Button onClick={() => move(1)} aria-label="Periodo successivo"><Icon name="next" size={16}/></Button><strong>{title}</strong></div><div className="inline-actions"><div className="tab-strip">{[["month","Mese"],["week","Settimana"],["list","Elenco"]].map(([v, label]) => <button type="button" key={v} className={view === v ? "tab-button active" : "tab-button"} onClick={() => setView(v)}>{label}</button>)}</div></div></div>
      <label className="check-row"><input type="checkbox" checked={includeDismissed} onChange={e => setIncludeDismissed(e.target.checked)}/> Includi attività archiviate nel calendario</label>
      {animalsPagination.totalPages > 1 && <div className="pagination-bar"><span className="muted">Animali disponibili nei selettori · pagina {animalsPagination.page}/{animalsPagination.totalPages} ({animalsPagination.total} attivi)</span><div className="inline-actions"><Button disabled={animalsPage <= 1 || saving} onClick={() => setAnimalsPage(p => p - 1)}>← Animali precedenti</Button><Button disabled={animalsPage >= animalsPagination.totalPages || saving} onClick={() => setAnimalsPage(p => p + 1)}>Altri animali →</Button></div></div>}
      {error && <p className="form-message" role="alert">{error}</p>}
      {taskFormOpen && <div className="embedded-form"><form className="form-grid" onSubmit={saveTask} key={taskEditing?.id || "new-task"}>
        <h3 className="form-full">{taskEditing ? "Modifica attività" : "Nuova attività"}</h3>
        <Field label="Titolo" name="title" defaultValue={taskEditing?.title || ""} required maxLength="160"/>
        <Select label="Categoria" name="category" defaultValue={taskEditing?.category || "custom"} options={CATEGORIES}/>
        <Field label="Scadenza" name="dueAt" type="datetime-local" defaultValue={dtInput(taskEditing?.dueAt)} required/>
        <label className="field"><span>Animale (facoltativo)</span><select name="animalId" defaultValue={taskEditing?.animalId || ""}><option value="">Nessun animale</option>{animals.map(a => <option key={a.id} value={a.id}>{a.name} · {a.species}</option>)}</select></label>
        <label className="field form-full"><span>Descrizione</span><textarea name="description" defaultValue={taskEditing?.description || ""} rows="3" maxLength="10000"/></label>
        <div className="form-actions form-full"><Button type="button" onClick={() => { setTaskFormOpen(false); setTaskEditing(null); }}>Annulla</Button><Button variant="primary" disabled={saving}>{saving ? "Salvataggio…" : "Salva attività"}</Button></div>
      </form></div>}
      {busy ? <div className="loading">Caricamento calendario…</div> : view === "list" ? <div className="log-list">{items.length ? items.map(renderItem) : <p className="muted">Nessun evento nell’intervallo scelto.</p>}</div> : <>
        <div className="calendar-grid calendar-weekdays">{monthNames.map(name => <div key={name}>{name}</div>)}</div>
        <div className="calendar-grid">
          {visibleDays.map(day => <div className={"calendar-day " + (view === "month" && day.getMonth() !== anchor.getMonth() ? "is-outside" : "") + (dateKey(day) === dateKey(new Date()) ? " is-today" : "")} key={dateKey(day)}>
            <strong>{day.getDate()}</strong><div className="calendar-day-items">{(byDay.get(dateKey(day)) || []).map(renderItem)}</div>
          </div>)}
        </div>
      </>}
      {items.length > 450 && <p className="notice warning">Il backend segnala un possibile troncamento dei risultati. Riduci l’intervallo o usa la vista settimanale per vedere meno eventi.</p>}
    </section>
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">AUTOMAZIONI</p><h2>Promemoria ricorrenti</h2><p className="subheading">Crea, modifica, sospendi o riattiva regole automatiche di scadenza.</p></div><Button variant="primary" onClick={() => setRuleForm({ id: null, title: "", category: "feeding", intervalDays: 14, nextDueAt: dtInput(), animalId: "", isEnabled: true })}>＋ Nuova regola</Button></div>
      {ruleForm && <div className="embedded-form"><form className="form-grid" onSubmit={saveRule} key={ruleForm.id || "new-rule"}>
        <h3 className="form-full">{ruleForm.id ? "Modifica regola" : "Nuova regola ricorrente"}</h3>
        <Field label="Titolo" name="title" defaultValue={ruleForm.title} required maxLength="160"/>
        <Select label="Categoria" name="category" defaultValue={ruleForm.category} options={CATEGORIES}/>
        <Field label="Intervallo (giorni)" name="intervalDays" type="number" defaultValue={ruleForm.intervalDays} min="1" max="3650" required/>
        <Field label="Prossima scadenza" name="nextDueAt" type="datetime-local" defaultValue={dtInput(ruleForm.nextDueAt)} required/>
        <label className="field"><span>Animale (facoltativo)</span><select name="animalId" defaultValue={ruleForm.animalId || ""}><option value="">Nessun animale</option>{animals.map(a => <option key={a.id} value={a.id}>{a.name} · {a.species}</option>)}</select></label>
        <label className="check-row"><input type="checkbox" name="isEnabled" defaultChecked={ruleForm.isEnabled !== false}/> Regola attiva</label>
        <div className="form-actions form-full"><Button type="button" onClick={() => setRuleForm(null)}>Annulla</Button><Button variant="primary" disabled={saving}>{saving ? "Salvataggio…" : "Salva regola"}</Button></div>
      </form></div>}
      {rules.length === 0 ? <div className="empty-state"><h3>Nessuna regola ricorrente</h3><p>Crea una regola per generare attività ricorrenti senza doverle inserire ogni volta.</p></div> : <div className="log-list">{rules.map(rule => <article className="log-row" key={rule.id}>
        <div><strong>{rule.title}</strong><p>{CATEGORIES.find(([v]) => v === rule.category)?.[1] || rule.category} · ogni {rule.intervalDays} giorni</p><small>Prossima scadenza: {dateLabel(rule.nextDueAt)} · {rule.animal?.name || "Tutto l’allevamento"}</small><small>{rule.isEnabled ? "Attiva" : "Disattivata"}</small></div>
        <div className="inline-actions"><Button onClick={() => setRuleForm({ ...rule, nextDueAt: dtInput(rule.nextDueAt), animalId: rule.animalId || "" })}>Modifica</Button><Button onClick={() => void toggleRule(rule)}>{rule.isEnabled ? "Disattiva" : "Riattiva"}</Button>{rule.isEnabled && <Button variant="danger" onClick={() => void deleteRule(rule)}>Termina</Button>}</div>
      </article>)}</div>}
      <div className="pagination-bar"><span className="muted">Pagina {rulePagination.page || rulePage} di {Math.max(1, rulePagination.totalPages || 1)} · {rulePagination.total ?? rules.length} regole</span><div className="inline-actions"><Button disabled={rulePage <= 1} onClick={() => setRulePage(p => Math.max(1, p - 1))}>← Precedente</Button><Button disabled={rulePage >= (rulePagination.totalPages || 1)} onClick={() => setRulePage(p => p + 1)}>Successiva →</Button></div></div>
    </section>
  </div>;
}
