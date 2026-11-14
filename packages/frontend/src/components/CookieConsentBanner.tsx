import { useEffect, useMemo, useState } from "react";
import type { Locale } from "../lib/domain";
import { cookiePreferencesAreComplete, COOKIE_POLICY_VERSION, OPEN_COOKIE_PREFERENCES_EVENT, OPTIONAL_COOKIE_SERVICES, readCookiePreferences, saveCookiePreferences, type OptionalCookieCategory } from "../lib/cookieConsent";

export function CookieConsentBanner({ locale }: { locale: Locale }) {
  const it = locale === "it";
  const [record, setRecord] = useState(readCookiePreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [choices, setChoices] = useState<Record<string, boolean>>(() => readCookiePreferences()?.services ?? {});
  const visible = !cookiePreferencesAreComplete(record);
  const analytics = useMemo(() => OPTIONAL_COOKIE_SERVICES.filter((service) => service.category === "analytics"), []);
  const marketing = useMemo(() => OPTIONAL_COOKIE_SERVICES.filter((service) => service.category === "marketing"), []);

  useEffect(() => {
    const open = () => {
      const latest = readCookiePreferences();
      setRecord(latest);
      setChoices(latest?.services ?? {});
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_COOKIE_PREFERENCES_EVENT, open);
    return () => window.removeEventListener(OPEN_COOKIE_PREFERENCES_EVENT, open);
  }, []);
  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  function save(next: Record<string, boolean>) {
    const saved = saveCookiePreferences(next);
    setRecord(saved);
    setChoices(saved.services);
    setSettingsOpen(false);
  }
  function acceptAll() { save(Object.fromEntries(OPTIONAL_COOKIE_SERVICES.map((service) => [service.id, true]))); }
  function rejectAll() { save(Object.fromEntries(OPTIONAL_COOKIE_SERVICES.map((service) => [service.id, false]))); }
  function acknowledge() { save({}); }

  const groups: Array<{ title: string; category: OptionalCookieCategory; services: typeof OPTIONAL_COOKIE_SERVICES }> = [
    { title: it ? "Statistiche" : "Analytics", category: "analytics", services: analytics },
    { title: "Marketing", category: "marketing", services: marketing }
  ];

  return <>
    {visible && <section className="cookie-banner" role="region" aria-label={it ? "Informativa sui cookie" : "Cookie notice"}>
      <div className="cookie-banner-copy"><p className="cookie-banner-eyebrow">{it ? "PRIVACY E COOKIE" : "PRIVACY & COOKIES"}</p><h2>{it ? "La tua privacy, senza sorprese" : "Your privacy, no surprises"}</h2>
        <p>{OPTIONAL_COOKIE_SERVICES.length === 0
          ? (it ? "In questa versione sono previsti solo strumenti tecnici necessari al funzionamento e alla sicurezza. Non risultano attivi strumenti facoltativi di analytics o marketing. Consulta l’informativa per i dettagli." : "This version uses only technical tools needed for functionality and security. No optional analytics or marketing tools are currently configured. Read the notice for details.")
          : (it ? "Usiamo strumenti tecnici necessari. Gli strumenti facoltativi elencati nelle preferenze restano disattivati finché non esprimi una scelta." : "We use necessary technical tools. Optional tools listed in preferences remain disabled until you make a choice.")}</p>
        <a href="/legal/cookies">{it ? "Leggi l’informativa cookie" : "Read the cookie notice"}</a>
      </div>
      <div className="cookie-banner-actions">{OPTIONAL_COOKIE_SERVICES.length === 0
        ? <button className="btn btn-primary" type="button" onClick={acknowledge}>{it ? "Ho capito" : "Got it"}</button>
        : <><button className="btn btn-secondary" type="button" onClick={rejectAll}>{it ? "Rifiuta facoltativi" : "Reject optional"}</button><button className="btn btn-secondary" type="button" onClick={() => setSettingsOpen(true)}>{it ? "Personalizza" : "Customize"}</button><button className="btn btn-primary" type="button" onClick={acceptAll}>{it ? "Accetta tutti" : "Accept all"}</button></>}</div>
    </section>}
    {!visible && !settingsOpen && <button className="cookie-settings-reopen" type="button" onClick={() => setSettingsOpen(true)}>{it ? "Preferenze cookie" : "Cookie preferences"}</button>}
    {settingsOpen && <div className="cookie-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <section className="cookie-dialog" role="dialog" aria-modal="true" aria-labelledby="cookie-dialog-title" aria-describedby="cookie-dialog-description">
        <button className="cookie-dialog-close" type="button" aria-label={it ? "Chiudi preferenze cookie" : "Close cookie preferences"} onClick={() => setSettingsOpen(false)}>×</button>
        <p className="cookie-banner-eyebrow">{it ? "PREFERENZE COOKIE" : "COOKIE PREFERENCES"}</p><h2 id="cookie-dialog-title">{it ? "Gestisci le tue preferenze" : "Manage your preferences"}</h2>
        <p id="cookie-dialog-description">{it ? "Gli strumenti tecnici necessari sono sempre attivi perché richiesti per fornire il servizio e proteggere l’account. Non possono essere disattivati da questo pannello." : "Necessary technical tools are always active because they are required to provide the service and protect your account. They cannot be disabled here."}</p>
        <div className="cookie-preference-row"><div><strong>{it ? "Necessari" : "Necessary"}</strong><p>{it ? "Autenticazione, sicurezza e funzionamento essenziale." : "Authentication, security and essential functionality."}</p></div><span className="cookie-always-on">{it ? "Sempre attivi" : "Always on"}</span></div>
        {OPTIONAL_COOKIE_SERVICES.length === 0
          ? <p className="cookie-no-optional">{it ? "Al momento non sono configurati servizi facoltativi. Per questo non ti chiediamo un consenso generico: se in futuro verranno aggiunti strumenti che richiedono consenso, saranno descritti qui e resteranno bloccati fino alla tua scelta." : "No optional services are currently configured. We therefore do not ask for generic consent. If consent-requiring tools are added in future, they will be described here and remain blocked until you choose."}</p>
          : groups.filter((group) => group.services.length > 0).map((group) => <div className="cookie-preference-group" key={group.category}><h3>{group.title}</h3>{group.services.map((service) => <label className="cookie-preference-row" key={service.id}><span><strong>{service.name}</strong><p>{service.purpose}</p></span><input type="checkbox" checked={choices[service.id] === true} onChange={(event) => setChoices((current) => ({ ...current, [service.id]: event.target.checked }))} aria-label={service.name} /></label>)}</div>)}
        <div className="cookie-dialog-actions">{OPTIONAL_COOKIE_SERVICES.length === 0
          ? <button className="btn btn-primary" type="button" onClick={() => { acknowledge(); setSettingsOpen(false); }}>{it ? "Ho capito" : "Got it"}</button>
          : <><button className="btn btn-secondary" type="button" onClick={rejectAll}>{it ? "Rifiuta facoltativi" : "Reject optional"}</button><button className="btn btn-secondary" type="button" onClick={() => save(choices)}>{it ? "Salva preferenze" : "Save preferences"}</button><button className="btn btn-primary" type="button" onClick={acceptAll}>{it ? "Accetta tutti" : "Accept all"}</button></>}</div>
        <p className="cookie-dialog-footnote">{it ? "Versione preferenze: " : "Preferences version: "}{COOKIE_POLICY_VERSION}</p>
      </section>
    </div>}
  </>;
}
