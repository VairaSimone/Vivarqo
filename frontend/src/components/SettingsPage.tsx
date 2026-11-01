import React, { useEffect, useState } from "react";
import type { AccountUser, NoticeHandler } from "../types";
import { Button, Field, SelectField } from "../ui/FormControls";
import { apiRequest } from "../api/api";
import { errorMessage } from "../types";
import { useConfirmDialog } from "../ui/ConfirmDialog";
import { getLocale, t } from "../i18n";


type UserPreferences = {
  weightUnit: string;
  temperatureUnit: string;
  dateFormat: string;
  defaultLandingPage: string;
  compactTables: boolean;
  theme: string;
};

const DEFAULT_PREFERENCES: UserPreferences = {
  weightUnit: "g",
  temperatureUnit: "c",
  dateFormat: "locale",
  defaultLandingPage: "today",
  compactTables: false,
  theme: "system",
};

export function SettingsPage({ user, onNotice, onLocaleApplied }: { user: AccountUser; onNotice: NoticeHandler; onLocaleApplied: (locale: "it" | "en") => void }) {
  const confirmAction = useConfirmDialog();
  const [displayName, setName] = useState(user.displayName || "");
  const [locale, setLocaleChoice] = useState<"it" | "en">(user.locale === "en" ? "en" : user.locale === "it" ? "it" : getLocale());
  const [timezone, setTimezone] = useState(user.timezone || "Europe/Rome");
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [email, setEmail] = useState(user.email || "");
  const [busy, setBusy] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesLoadError, setPreferencesLoadError] = useState("");
  const [preferencesLoadAttempt, setPreferencesLoadAttempt] = useState(0);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Keep the form choice aligned with the header's account-level selector.
  useEffect(() => {
    setLocaleChoice(user.locale === "en" ? "en" : user.locale === "it" ? "it" : getLocale());
  }, [user.locale]);

  useEffect(() => {
    let active = true;
    setPreferencesLoading(true);
    setPreferencesLoadError("");
    apiRequest("account/preferences")
      .then((result) => {
        if (!active) return;
        setPreferences({ ...DEFAULT_PREFERENCES, ...(result.preferences || {}) });
        setPreferencesLoaded(true);
      })
      .catch((error) => {
        if (!active) return;
        setPreferencesLoaded(false);
        setPreferencesLoadError(errorMessage(error));
      })
      .finally(() => { if (active) setPreferencesLoading(false); });
    return () => { active = false; };
  }, [onNotice, preferencesLoadAttempt]);

  const updatePreference = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => setPreferences((current) => ({ ...current, [key]: value }));

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const canSavePreferences = preferencesLoaded;
    try {
      if (canSavePreferences) {
        await apiRequest("account/preferences", { method: "PATCH", body: preferences });
        window.dispatchEvent(new CustomEvent("vivarqo:preferences-updated", { detail: preferences }));
      }
      const body: Record<string, unknown> = { displayName, locale, timezone };
      if (email !== user.email || newPassword) {
        body.email = email;
        body.currentPassword = currentPassword;
        if (newPassword) body.newPassword = newPassword;
      }
      const result = await apiRequest("account", { method: "PATCH", body });
      onLocaleApplied(locale);
      if (canSavePreferences) {
        onNotice(result.message || "Impostazioni e preferenze aggiornate.");
      } else {
        onNotice("Profilo aggiornato. Le preferenze non sono state modificate perché non erano disponibili.", "warning");
      }
      setCurrent("");
      setNew("");
    } catch (error) {
      onNotice(errorMessage(error), "error");
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
      onNotice(errorMessage(error), "error");
    } finally {
      setDeleting(false);
    }
  };

  return <section className="panel settings-panel">
    <p className="eyebrow">{t("PROFILO E SICUREZZA")}</p>
    <h2>{t("Impostazioni account")}</h2>
    <form className="form-grid" onSubmit={save}>
      <Field label={t("Nome visualizzato")} value={displayName} onChange={(event) => setName(event.target.value)} required maxLength={120}/>
      <Field label={t("Email")} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required/>
      <SelectField label={t("Lingua")} value={locale} onChange={(event) => setLocaleChoice(event.target.value === "en" ? "en" : "it")}>
        <option value="it">{t("Italiano")}</option><option value="en">{t("English")}</option>
      </SelectField>
      <p className="muted form-full">{t("La lingua del browser viene rilevata automaticamente al primo accesso. Puoi cambiarla qui: la scelta verrà salvata nel tuo account.")}</p>
      <Field label={t("Fuso orario IANA")} value={timezone} onChange={(event) => setTimezone(event.target.value)} required/>
      <div className="form-full">
        <h3>{t("Preferenze di visualizzazione")}</h3>
        {preferencesLoading && <p className="muted" role="status">{t("Caricamento preferenze…")}</p>}
        {preferencesLoadError && <div className="form-message error-text" role="alert">
          <p>{t("Non è stato possibile caricare le preferenze. Non verranno modificate dal salvataggio del profilo.")}</p>
          <Button type="button" variant="secondary" disabled={preferencesLoading} onClick={() => setPreferencesLoadAttempt(value => value + 1)}>{t("Riprova a caricare le preferenze")}</Button>
        </div>}
      </div>
      <SelectField disabled={!preferencesLoaded || busy} label={t("Unità di peso")} value={preferences.weightUnit} onChange={(event) => updatePreference("weightUnit", event.target.value)}>
        <option value="g">{t("Grammi (g)")}</option><option value="kg">{t("Chilogrammi (kg)")}</option><option value="oz">{t("Once (oz)")}</option><option value="lb">{t("Libbre (lb)")}</option>
      </SelectField>
      <SelectField disabled={!preferencesLoaded || busy} label={t("Unità di temperatura")} value={preferences.temperatureUnit} onChange={(event) => updatePreference("temperatureUnit", event.target.value)}>
        <option value="c">{t("Celsius (°C)")}</option><option value="f">{t("Fahrenheit (°F)")}</option>
      </SelectField>
      <SelectField disabled={!preferencesLoaded || busy} label={t("Formato data")} value={preferences.dateFormat} onChange={(event) => updatePreference("dateFormat", event.target.value)}>
        <option value="locale">{t("Secondo la lingua")}</option><option value="dd/MM/yyyy">{t("GG/MM/AAAA")}</option><option value="yyyy-MM-dd">{t("AAAA-MM-GG")}</option>
      </SelectField>
      <SelectField disabled={!preferencesLoaded || busy} label={t("Schermata iniziale")} value={preferences.defaultLandingPage} onChange={(event) => updatePreference("defaultLandingPage", event.target.value)}>
        <option value="today">{t("Oggi")}</option><option value="animals">{t("Animali")}</option><option value="calendar">{t("Calendario")}</option>
      </SelectField>
      <SelectField disabled={!preferencesLoaded || busy} label={t("Tema")} value={preferences.theme} onChange={(event) => updatePreference("theme", event.target.value)}>
        <option value="system">{t("Automatico")}</option><option value="light">{t("Chiaro")}</option><option value="dark">{t("Scuro")}</option>
      </SelectField>
      <label className="field checkbox-field"><span>{t("Tabelle compatte")}</span><input type="checkbox" checked={preferences.compactTables} disabled={!preferencesLoaded || busy} onChange={(event) => updatePreference("compactTables", event.target.checked)}/></label>
      <div className="form-full">
        <Field label={t("Password attuale (richiesta per modificare email o password)")} type="password" value={currentPassword} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password"/>
        <Field label={t("Nuova password (facoltativa)")} type="password" value={newPassword} onChange={(event) => setNew(event.target.value)} autoComplete="new-password" minLength={12}/>
      </div>
      <div className="form-full"><Button disabled={busy || !preferencesLoaded}>{busy ? "Salvataggio…" : "Salva impostazioni"}</Button></div>
    </form>

    <div className="security-actions">
      <Button variant="secondary" onClick={async () => {
        if (!(await confirmAction({ title: "Revocare tutte le sessioni?", message: "Dovrai effettuare nuovamente l’accesso su tutti i dispositivi.", confirmLabel: "Revoca sessioni", danger: true }))) return;
        try {
          await apiRequest("auth/sessions/revoke-all", { method: "POST", body: {} });
          onNotice("Sessioni revocate. Esci e accedi di nuovo.");
        } catch (error) { onNotice(errorMessage(error), "error"); }
      }}>Revoca tutte le sessioni</Button>
    </div>

    <section className="danger-zone" aria-labelledby="delete-account-heading">
      <h3 id="delete-account-heading">{t("Eliminazione account")}</h3>
      <p>{t("La cancellazione rimuove i dati gestionali e i file privati associati. È richiesta la password attuale.")}</p>
      <Field label={t("Password attuale")} type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password"/>
      <Field label='Scrivi DELETE per confermare' value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off"/>
      <Button variant="danger" disabled={deleting || deleteConfirmation !== "DELETE" || !deletePassword} onClick={deleteAccount}>{deleting ? "Eliminazione…" : "Elimina definitivamente l'account"}</Button>
    </section>
  </section>;
}
