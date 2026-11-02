import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { Alert, Button, Field, Input, Icon } from "../components/ui";

type AuthMode = "login" | "register" | "forgot" | "reset" | "verify" | "resend";

export function AuthPage({ mode, locale, onSuccess, navigate, onLocaleChange }: {
  mode: AuthMode; locale: Locale; onSuccess: () => void; navigate: (path: string) => void;
  onLocaleChange?: (locale: Locale) => void;
}) {
  const t = (key: string) => translate(locale, key);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "login") {
        await api.post("/auth/login", { email, password });
        onSuccess();
        return;
      }
      if (mode === "register") {
        await api.post("/auth/register", { displayName, email, password, locale });
        setNotice(t("registrationSent"));
      } else if (mode === "forgot") {
        await api.post("/auth/forgot-password", { email });
        setNotice(t("genericEmailNotice"));
      } else if (mode === "resend") {
        await api.post("/auth/resend-verification", { email });
        setNotice(t("genericEmailNotice"));
      } else if (mode === "reset") {
        if (!token) throw new Error(t("invalidResetLink"));
        await api.post("/auth/reset-password", { token, password });
        setNotice(t("passwordReset"));
        navigate("/login");
      } else if (mode === "verify") {
        if (!token) throw new Error(t("invalidVerificationLink"));
        await api.post("/auth/verify-email", { token });
        setNotice(t("emailVerified"));
        navigate("/login");
      }
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : t("operationFailed"));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "login" ? t("loginTitle")
    : mode === "register" ? t("registerTitle")
    : mode === "forgot" ? t("forgotTitle")
    : mode === "resend" ? t("resendVerification")
    : mode === "reset" ? t("resetTitle")
    : t("verifyEmail");
  const subtitle = mode === "login" ? t("loginSubtitle")
    : mode === "register" ? t("registerSubtitle")
    : mode === "forgot" ? t("forgotSubtitle")
    : mode === "resend" ? t("resendVerificationHint")
    : mode === "reset" ? t("resetSubtitle")
    : t("emailVerificationHint");
  const needsEmail = mode === "login" || mode === "register" || mode === "forgot" || mode === "resend";
  const needsPassword = mode === "login" || mode === "register" || mode === "reset";

  return <div className="auth-page">
    <div className="auth-visual">
      <div className="auth-brand"><span className="brand-mark"><Icon name="leaf" size={23} /></span><strong>vivarqo</strong></div>
      <div className="auth-visual-copy">
        <span className="eyebrow">{locale === "it" ? "SPAZIO PER ALLEVATORI" : "THE BREEDER'S WORKSPACE"}</span>
        <h1>{locale === "it" ? "Ogni dettaglio,\nsotto controllo." : "Every detail,\nunder control."}</h1>
        <p>{locale === "it" ? "Un ambiente ordinato per gestire animali, attività e processi di allevamento con precisione." : "A considered workspace to manage animals, daily care and breeding operations with precision."}</p>
      </div>
      <div className="auth-visual-foot"><span>V / 01</span><span>{t("brandTagline")}</span></div>
      <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
    </div>
    <div className="auth-form-side">
      <div className="auth-top"><span>{t("language")}</span><button type="button" onClick={() => onLocaleChange?.(locale === "it" ? "en" : "it")}>{locale === "it" ? "Italiano" : "English"} · <b>{locale === "it" ? "Switch to English" : "Passa all'italiano"}</b></button></div>
      <div className="auth-card">
        <span className="eyebrow">{mode === "login" ? (locale === "it" ? "BENTORNATO" : "WELCOME BACK") : (locale === "it" ? "INIZIA QUI" : "GET STARTED")}</span>
        <h2>{title}</h2><p className="auth-subtitle">{subtitle}</p>
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        <form onSubmit={submit} className="form-stack">
          {mode === "register" && <Field label={t("displayName")}><Input required autoComplete="name" maxLength={120} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>}
          {needsEmail && <Field label={t("email")}><Input required type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>}
          {needsPassword && <Field label={t("password")} hint={mode !== "login" ? t("passwordPolicy") : undefined}><Input required type="password" minLength={mode === "login" ? 1 : 12} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
          {(mode === "reset" || mode === "verify") && !token && <Alert tone="danger">{mode === "reset" ? t("invalidResetLink") : t("invalidVerificationLink")}</Alert>}
          <Button type="submit" size="lg" disabled={busy || ((mode === "reset" || mode === "verify") && !token)}>
            {busy ? t("loading") : mode === "login" ? t("signIn") : mode === "register" ? t("createAccount") : mode === "forgot" ? t("sendLink") : mode === "resend" ? t("resendVerification") : mode === "reset" ? t("resetPassword") : t("verifyEmail")}
            <Icon name="arrow" size={16} />
          </Button>
        </form>
        <div className="auth-links">
          {mode === "login" && <div className="auth-link-stack"><button type="button" onClick={() => navigate("/forgot-password")}>{t("forgotPassword")}</button><button type="button" onClick={() => navigate("/resend-verification")}>{t("resendVerification")}</button></div>}
          {mode !== "login" && mode !== "register" && <button type="button" onClick={() => navigate("/login")}>{t("signIn")}</button>}
          {mode === "register" && <button type="button" onClick={() => navigate("/login")}>{t("haveAccount")}</button>}
          {mode === "login" && <button type="button" onClick={() => navigate("/register")}>{t("noAccount")} · {t("createAccount")}</button>}
        </div>
      </div>
      <div className="auth-legal">Vivarqo · {new Date().getFullYear()} <span>{locale === "it" ? "Spazio privato" : "Private workspace"}</span></div>
    </div>
  </div>;
}
