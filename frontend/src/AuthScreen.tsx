// @ts-nocheck -- staged migration: preserve legacy runtime while explicit prop/data types are introduced.
import React, { useMemo, useState } from "react";
import { apiRequest } from "./api/api.js";

const currentUrl = () => new URL(window.location.href);
function initialMode() {
  const url = currentUrl();
  const path = url.pathname.replace(/\/$/, "");
  const queryMode = url.searchParams.get("mode");
  if (path === "/verify-email" || queryMode === "verify") return "verify";
  if (path === "/reset-password" || queryMode === "reset") return "reset";
  return "login";
}
function Button({ children, variant = "", ...props }) {
  return <button className={"button " + variant} {...props}>{children}</button>;
}
function Field({ label, ...props }) {
  return <label className="field"><span>{label}</span><input {...props}/></label>;
}
function cleanFlowUrl() {
  if (/^\/(verify-email|reset-password)\/?$/.test(window.location.pathname)) {
    window.history.replaceState({}, "", "/");
  } else {
    const url = currentUrl();
    url.searchParams.delete("token");
    url.searchParams.delete("mode");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }
}

export function AuthScreen({ onLogin = () => window.location.assign("/") }) {
  const [mode, setMode] = useState(initialMode);
  const [token, setToken] = useState(() => currentUrl().searchParams.get("token") || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState("info");
  const tokenRequired = mode === "verify" || mode === "reset";
  const title = useMemo(() => ({
    login: "Accedi a Vivarqo",
    register: "Crea il tuo account",
    forgot: "Recupera l’accesso",
    resend: "Verifica la tua email",
    verify: "Conferma l’indirizzo email",
    reset: "Scegli una nuova password"
  }[mode] || "Accedi a Vivarqo"), [mode]);

  const switchMode = next => {
    setMode(next);
    setMessage("");
    if (next === "login" && /^\/(verify-email|reset-password)\/?$/.test(window.location.pathname)) {
      window.history.replaceState({}, "", "/");
    }
  };

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    try {
      let path = "";
      let body = values;
      if (mode === "login") path = "auth/login";
      else if (mode === "register") path = "auth/register";
      else if (mode === "forgot") path = "auth/forgot-password";
      else if (mode === "resend") path = "auth/resend-verification";
      else if (mode === "verify") { path = "auth/verify-email"; body = { token: values.token.trim() }; }
      else if (mode === "reset") {
        if (values.password !== values.confirmPassword) throw new Error("Le due password non coincidono.");
        path = "auth/reset-password";
        body = { token: values.token.trim(), password: values.password };
      }
      delete body.confirmPassword;
      await apiRequest(path, { method: "POST", body });
      if (mode === "login") {
        await onLogin();
        return;
      }
      if (mode === "register") {
        setMessage("Account creato. Controlla l’email e apri il link di verifica prima di accedere.");
        setMessageKind("success");
        setMode("login");
      } else if (mode === "verify") {
        setMessage("Email verificata. Ora puoi accedere.");
        setMessageKind("success");
        cleanFlowUrl();
        setMode("login");
        setToken("");
      } else if (mode === "reset") {
        setMessage("Password aggiornata. Accedi usando la nuova password.");
        setMessageKind("success");
        cleanFlowUrl();
        setMode("login");
        setToken("");
      } else {
        setMessage("Se l’indirizzo è associato a un account, riceverai le istruzioni via email.");
        setMessageKind("success");
      }
    } catch (error) {
      setMessage(error?.message || "Operazione non riuscita. Riprova.");
      setMessageKind("error");
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-wrap">
    <div className="auth-art"><a className="brand" href="/" aria-label="Vivarqo"><span className="brand-mark">v</span><span>vivarqo<span className="brand-dot">.</span></span></a><p className="eyebrow">IL GESTIONALE PER ALLEVATORI</p><h1>Più cura.<br/><em>Meno fogli.</em></h1><p>Animali, alimentazioni, documenti e riproduzioni: tutto in un unico spazio, pensato anche per il telefono.</p><div className="auth-leaf">❧</div></div>
    <section className="auth-card">
      <div className="auth-card-head"><p className="eyebrow">{mode === "verify" ? "UN ULTIMO PASSAGGIO" : mode === "reset" ? "RECUPERO ACCOUNT" : "BENTORNATO"}</p><h2>{title}</h2><p>I tuoi registri restano privati e collegati al tuo account.</p></div>
      <form className="form-stack" onSubmit={submit}>
        {mode === "register" && <Field label="Nome visualizzato" name="displayName" autoComplete="name" required maxLength="120"/>}
        {["login", "register", "forgot", "resend"].includes(mode) && <Field label="Email" name="email" type="email" autoComplete="email" required maxLength="254"/>}
        {["login", "register"].includes(mode) && <Field label="Password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 12 : 1} maxLength="128"/>}
        {tokenRequired && <><Field label="Token ricevuto via email" name="token" value={token} onChange={event => setToken(event.target.value)} required minLength="43" maxLength="43" autoComplete="one-time-code" spellCheck="false"/>{mode === "verify" && <p className="muted">Apri il link ricevuto via email. Se il token non è compilato automaticamente, incollalo qui.</p>}</>}
        {mode === "reset" && <><Field label="Nuova password" name="password" type="password" autoComplete="new-password" required minLength="12" maxLength="128"/><Field label="Conferma nuova password" name="confirmPassword" type="password" autoComplete="new-password" required minLength="12" maxLength="128"/></>}
        {mode === "forgot" && <p className="muted">Ti invieremo le istruzioni se l’indirizzo è associato a un account.</p>}
        <Button disabled={busy}>{busy ? "Attendi…" : ({login:"Accedi",register:"Crea account",forgot:"Invia istruzioni",resend:"Invia nuovo link",verify:"Verifica email",reset:"Reimposta password"}[mode])}</Button>
      </form>
      {message && <p className={"form-message " + (messageKind === "success" ? "success-text" : messageKind === "error" ? "error-text" : "")} role="status">{message}</p>}
      <div className="auth-links">
        {mode !== "login" && <button type="button" onClick={() => switchMode("login")}>Torna all’accesso</button>}
        {mode === "login" && <><button type="button" onClick={() => switchMode("forgot")}>Password dimenticata?</button><button type="button" onClick={() => switchMode("register")}>Crea un account</button><button type="button" onClick={() => switchMode("resend")}>Reinvia verifica</button></>}
        {mode === "register" && <button type="button" onClick={() => switchMode("resend")}>Non hai ricevuto il link?</button>}
      </div>
      <p className="tiny">Registrandoti dichiari di aver letto l’informativa privacy e le condizioni applicabili pubblicate dal gestore.</p>
    </section>
  </main>;
}
export default AuthScreen;
