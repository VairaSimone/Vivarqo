import React, { useEffect, useState } from "react";
import { apiRequest } from "../api/api.js";
import { useConfirmDialog } from "../ui/ConfirmDialog.jsx";

function Button({ children, variant = "", ...props }) { return <button className={"button " + variant} {...props}>{children}</button>; }
function Field({ label, ...props }) { return <label className="field"><span>{label}</span><input {...props}/></label>; }
function SelectField({ label, children, ...props }) { return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>; }

const DEFAULT_PREFERENCES = {
  weightUnit: "g",
  temperatureUnit: "c",
  dateFormat: "locale",
  defaultLandingPage: "today",
  compactTables: false,
  theme: "system",
};

export function SettingsPage({ user, onNotice }) {
  const confirmAction = useConfirmDialog();
  const [displayName, setName] = useState(user.displayName || "");
  const [locale, setLocale] = useState(user.locale || "it");
  const [timezone, setTimezone] = useState(user.timezone || "Europe/Rome");
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [email, setEmail] = useState(user.email || "");
  const [busy, setBusy] = useState(false);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest("account/preferences")
      .then((result) => {
        if (active) setPreferences({ ...DEFAULT_PREFERENCES, ...(result.preferences || {}) });
      })
      .catch((error) => {
        if (active) onNotice(error.message || "Impossibile caricare le preferenze.", "error");
      })
      .finally(() => { if (active) setPreferencesLoaded(true); });
    return () => { active = false; };
  }, [onNotice]);

  const updatePreference = (key, value) => setPreferences((current) => ({ ...current, [key]: value }));

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest("account/preferences", { method: "PATCH", body: preferences });
      const body = { displayName, locale, timezone };
      if (email !== user.email || newPassword) {
        body.email = email;
        body.currentPassword = currentPassword;
        if (newPassword) body.newPassword = newPassword;
      }
      const result = await apiRequest("account", { method: "PATCH", body });
      onNotice(result.message || "Impostazioni e preferenze aggiornate.");
      setCurrent("");
      setNew("");
    } catch (error) {
      onNotice(error.message || "Impossibile salvare le impostazioni.", "error");
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirmation !== "DELETE" || !deletePassword) {
      onNotice("Inserisci la password attuale e scrivi DELETE per confermare.", "error");
      return;
    }
    const confirmed = await confirmAction({
      title: "Eliminare definitivamente l'account?",
      message: "Verranno cancellati animali, registri, riproduzioni, documenti, esportazioni e preferenze. L'operazione non può essere annullata. Gli addebiti ricorrenti Stripe, se presenti, saranno prima annullati.",
      confirmLabel: "Elimina account",
      danger: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await apiRequest("account", {
        method: "DELETE",
        body: { currentPassword: deletePassword, confirmation: "DELETE" },
      });
      window.location.replace("/");
    } catch (error) {
      onNotice(error.message || "Impossibile eliminare l'account.", "error");
    } finally {
      setDeleting(false);
    }
  };

  return <section className="panel settings-panel">
    <p className="eyebrow">PROFILO E SICUREZZA</p>
    <h2>Impostazioni account</h2>
    <form className="form-grid" onSubmit={save}>
      <Field label="Nome visualizzato" value={displayName} onChange={(event) => setName(event.target.value)} required maxLength="120"/>
      <Field label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required/>
      <SelectField label="Lingua" value={locale} onChange={(event) => setLocale(event.target.value)}>
        <option value="it">Italiano</option><option value="en">English</option>
      </SelectField>
      <Field label="Fuso orario IANA" value={timezone} onChange={(event) => setTimezone(event.target.value)} required/>
      <div className="form-full"><h3>Preferenze di visualizzazione</h3></div>
      <SelectField label="Unità di peso" value={preferences.weightUnit} onChange={(event) => updatePreference("weightUnit", event.target.value)}>
        <option value="g">Grammi (g)</option><option value="kg">Chilogrammi (kg)</option><option value="oz">Once (oz)</option><option value="lb">Libbre (lb)</option>
      </SelectField>
      <SelectField label="Unità di temperatura" value={preferences.temperatureUnit} onChange={(event) => updatePreference("temperatureUnit", event.target.value)}>
        <option value="c">Celsius (°C)</option><option value="f">Fahrenheit (°F)</option>
      </SelectField>
      <SelectField label="Formato data" value={preferences.dateFormat} onChange={(event) => updatePreference("dateFormat", event.target.value)}>
        <option value="locale">Secondo la lingua</option><option value="dd/MM/yyyy">GG/MM/AAAA</option><option value="yyyy-MM-dd">AAAA-MM-GG</option>
      </SelectField>
      <SelectField label="Schermata iniziale" value={preferences.defaultLandingPage} onChange={(event) => updatePreference("defaultLandingPage", event.target.value)}>
        <option value="today">Oggi</option><option value="animals">Animali</option><option value="calendar">Calendario</option>
      </SelectField>
      <SelectField label="Tema" value={preferences.theme} onChange={(event) => updatePreference("theme", event.target.value)}>
        <option value="system">Automatico</option><option value="light">Chiaro</option><option value="dark">Scuro</option>
      </SelectField>
      <label className="field checkbox-field"><span>Tabelle compatte</span><input type="checkbox" checked={preferences.compactTables} onChange={(event) => updatePreference("compactTables", event.target.checked)}/></label>
      <div className="form-full">
        <Field label="Password attuale (richiesta per modificare email o password)" type="password" value={currentPassword} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password"/>
        <Field label="Nuova password (facoltativa)" type="password" value={newPassword} onChange={(event) => setNew(event.target.value)} autoComplete="new-password" minLength="12"/>
      </div>
      <div className="form-full"><Button disabled={busy || !preferencesLoaded}>{busy ? "Salvataggio…" : "Salva impostazioni"}</Button></div>
    </form>

    <div className="security-actions">
      <Button variant="secondary" onClick={async () => {
        if (!(await confirmAction({ title: "Revocare tutte le sessioni?", message: "Dovrai effettuare nuovamente l’accesso su tutti i dispositivi.", confirmLabel: "Revoca sessioni", danger: true }))) return;
        try {
          await apiRequest("auth/sessions/revoke-all", { method: "POST", body: {} });
          onNotice("Sessioni revocate. Esci e accedi di nuovo.");
        } catch (error) { onNotice(error.message, "error"); }
      }}>Revoca tutte le sessioni</Button>
    </div>

    <section className="danger-zone" aria-labelledby="delete-account-heading">
      <h3 id="delete-account-heading">Eliminazione account</h3>
      <p>La cancellazione rimuove i dati gestionali e i file privati associati. È richiesta la password attuale.</p>
      <Field label="Password attuale" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password"/>
      <Field label='Scrivi DELETE per confermare' value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off"/>
      <Button variant="danger" disabled={deleting || deleteConfirmation !== "DELETE" || !deletePassword} onClick={deleteAccount}>{deleting ? "Eliminazione…" : "Elimina definitivamente l'account"}</Button>
    </section>
  </section>;
}
