import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import type { Locale } from "../../lib/domain";
import { Alert, Badge, Button, EmptyState, Field, LoadingState, PageHeader, Panel, PanelHeader, Select } from "../../components/ui";

type Role = "admin" | "operator" | "breeding" | "viewer";
type Collaborator = { id: string; role: Role; createdAt: string; user: { id: string; email: string; displayName: string } };
type Invitation = { id: string; email: string; role: Role; expiresAt: string; createdAt: string };
type Workspace = { ownerUserId: string; role: Role; owner: { id: string; displayName: string; email: string }; active: boolean };
type Data = { collaborators: Collaborator[]; invitations: Invitation[]; workspaces: Workspace[]; activeWorkspaceOwnerId: string | null };

const roleNames: Record<Role, { it: string; en: string }> = {
  admin: { it: "Amministratore", en: "Administrator" },
  operator: { it: "Operatore", en: "Operator" },
  breeding: { it: "Riproduzione e genetica", en: "Breeding and genetics" },
  viewer: { it: "Sola lettura", en: "Read only" },
};
const roleDescriptions: Record<Role, { it: string; en: string }> = {
  admin: { it: "Gestisce tutte le aree operative. Non gestisce l’abbonamento del workspace e non accede a finanze o esportazioni complete.", en: "Manages operational areas. Cannot manage workspace billing or access finances and full exports." },
  operator: { it: "Gestisce anagrafiche, alimentazioni, pesi, mute, salute e attività.", en: "Manages animals, feeding, weights, sheds, health and tasks." },
  breeding: { it: "Consulta gli animali e modifica riproduzioni, covate, incubazione e genetica.", en: "Views animals and edits reproduction, clutches, incubation and genetics." },
  viewer: { it: "Può consultare i dati, senza modificarli.", en: "Can view data but cannot make changes." },
};
const roleOptions: Role[] = ["admin", "operator", "breeding", "viewer"];

export function CollaboratorsPage({ locale, navigate }: { locale: Locale; navigate: (path: string) => void }) {
  const en = locale === "en";
  const [data, setData] = useState<Data | null>(null);
  const [premium, setPremium] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const result = await api.get<Data & { premiumEnabled: boolean }>("/collaborators");
    setData(result);
    setPremium(result.premiumEnabled);
  }, []);

  useEffect(() => {
    let active = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("invite");
    if (token) {
      window.history.replaceState({}, "", window.location.pathname);
      setBusy(true);
      api.post("/collaborators/accept", { token })
        .then(async () => {
          if (!active) return;
          setMessage(en ? "Invitation accepted. You can now switch to the shared workspace." : "Invito accettato. Ora puoi passare al workspace condiviso.");
          await load();
        })
        .catch(async (reason) => { if (active) setError(reason instanceof ApiError ? reason.message : (en ? "Invitation could not be accepted." : "Impossibile accettare l'invito.")); if (active) await load().catch(() => undefined); })
        .finally(() => { if (active) setBusy(false); });
    } else {
      load().catch((reason) => { if (active) setError(reason instanceof ApiError ? reason.message : (en ? "Could not load collaborators." : "Impossibile caricare i collaboratori.")); });
    }
    return () => { active = false; };
  }, [load, en]);

  async function invite(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await api.post("/collaborators/invitations", { email, role });
      setEmail("");
      setMessage(en ? "Invitation sent. The link is valid for 7 days." : "Invito inviato. Il link è valido per 7 giorni.");
      await load();
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : (en ? "Invitation failed." : "Invio dell'invito non riuscito.")); }
    finally { setBusy(false); }
  }
  async function updateRole(id: string, nextRole: Role) {
    setBusy(true); setError("");
    try { await api.patch("/collaborators/" + id, { role: nextRole }); await load(); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : (en ? "Role update failed." : "Modifica del ruolo non riuscita.")); }
    finally { setBusy(false); }
  }
  async function removeCollaborator(item: Collaborator) {
    if (!window.confirm(en ? `Remove access for ${item.user.email}?` : `Revocare l'accesso a ${item.user.email}?`)) return;
    setBusy(true); setError("");
    try { await api.delete("/collaborators/" + item.id); await load(); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : (en ? "Access could not be revoked." : "Impossibile revocare l'accesso.")); }
    finally { setBusy(false); }
  }
  async function revokeInvitation(item: Invitation) {
    if (!window.confirm(en ? `Revoke the pending invitation for ${item.email}?` : `Revocare l'invito per ${item.email}?`)) return;
    setBusy(true); setError("");
    try { await api.delete("/collaborators/invitations/" + item.id); await load(); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : (en ? "Invitation could not be revoked." : "Impossibile revocare l'invito.")); }
    finally { setBusy(false); }
  }
  async function leaveWorkspace(workspace: Workspace) {
    if (!window.confirm(en ? `Leave ${workspace.owner.displayName}'s workspace?` : `Uscire dal workspace di ${workspace.owner.displayName}?`)) return;
    setBusy(true); setError("");
    try {
      await api.post("/collaborators/leave", { ownerUserId: workspace.ownerUserId });
      if (workspace.active) window.location.assign("/today");
      else await load();
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : (en ? "Could not leave workspace." : "Impossibile uscire dal workspace.")); }
    finally { setBusy(false); }
  }
  async function switchWorkspace(ownerUserId: string | null) {
    setBusy(true); setError("");
    try {
      await api.post("/collaborators/active-workspace", { ownerUserId });
      window.location.assign("/today");
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : (en ? "Workspace could not be changed." : "Impossibile cambiare workspace.")); }
    finally { setBusy(false); }
  }

  if (!data) return <div className="page-stack"><PageHeader eyebrow="Workspace" title={en ? "Collaborators" : "Collaboratori"} description={en ? "Manage shared access to your workspace." : "Gestisci gli accessi condivisi al tuo workspace."} />{error ? <Alert tone="danger">{error}</Alert> : <LoadingState />}<Button variant="secondary" onClick={() => void load()}>{en ? "Retry" : "Riprova"}</Button></div>;
  return <div className="page-stack">
    <PageHeader eyebrow={en ? "Workspace" : "Workspace"} title={en ? "Collaborators" : "Collaboratori"} description={en ? "Invite people into your personal workspace and choose what they can see and change." : "Invita persone nel tuo workspace personale e scegli cosa possono vedere e modificare."} action={<Button variant="secondary" onClick={() => navigate("/billing")}>{en ? "Subscription" : "Abbonamento"}</Button>} />
    {error && <Alert tone="danger">{error}</Alert>}
    {message && <Alert tone="success">{message}</Alert>}

    <Panel>
      <PanelHeader title={en ? "Active workspace" : "Workspace attivo"} description={en ? "Choose which breeder's data you are currently working on." : "Scegli i dati di quale allevamento stai gestendo in questo momento."} />
      <div className="form-stack">
        <div className="workspace-switch-row">
          <div><strong>{en ? "Personal workspace" : "Workspace personale"}</strong><p className="muted-note">{en ? "Your own account and data." : "Il tuo account e i tuoi dati."}</p></div>
          <Button size="sm" variant={data.activeWorkspaceOwnerId === null ? "primary" : "secondary"} disabled={busy || data.activeWorkspaceOwnerId === null} onClick={() => void switchWorkspace(null)}>{data.activeWorkspaceOwnerId === null ? (en ? "Active" : "Attivo") : (en ? "Switch" : "Passa")}</Button>
        </div>
        {data.workspaces.map((workspace) => <div className="workspace-switch-row" key={workspace.ownerUserId}>
          <div><strong>{workspace.owner.displayName}</strong><p className="muted-note">{workspace.owner.email} · {roleNames[workspace.role][en ? "en" : "it"]}</p></div>
          <div className="inline-actions"><Button size="sm" variant={workspace.active ? "primary" : "secondary"} disabled={busy || workspace.active} onClick={() => void switchWorkspace(workspace.ownerUserId)}>{workspace.active ? (en ? "Active" : "Attivo") : (en ? "Switch" : "Passa")}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void leaveWorkspace(workspace)}>{en ? "Leave" : "Esci"}</Button></div>
        </div>)}
        {data.workspaces.length === 0 && <p className="muted-note">{en ? "You have not joined any shared workspace yet." : "Non hai ancora aderito a workspace condivisi."}</p>}
      </div>
    </Panel>

    <Panel>
      <PanelHeader title={en ? "Invite a collaborator" : "Invita un collaboratore"} description={en ? "Invitations always belong to your personal workspace, not the shared workspace currently selected." : "Gli inviti vengono sempre associati al tuo workspace personale, non a quello condiviso attualmente selezionato."} />
      {!premium ? <Alert tone="warning">{en ? "Collaborators are a Premium feature. Activate Premium to send invitations." : "I collaboratori sono una funzione Premium. Attiva Premium per inviare inviti."} <button className="text-link" onClick={() => navigate("/billing")}>{en ? "View plans" : "Vai all'abbonamento"}</button></Alert> :
      <form className="form-grid" onSubmit={invite}>
        <Field label={en ? "Email address" : "Indirizzo email"}><input className="control" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@esempio.it" /></Field>
        <Field label={en ? "Role" : "Ruolo"}><Select value={role} onChange={(event) => setRole(event.target.value as Role)}>{roleOptions.map((item) => <option key={item} value={item}>{roleNames[item][en ? "en" : "it"]}</option>)}</Select></Field>
        <div className="field-span-full"><p className="muted-note">{roleDescriptions[role][en ? "en" : "it"]}</p><Button type="submit" disabled={busy || !email.trim()}>{en ? "Send invitation" : "Invia invito"}</Button></div>
      </form>}
    </Panel>

    <Panel>
      <PanelHeader title={en ? "Collaborators with access" : "Collaboratori con accesso"} description={en ? "Changes take effect on the next request; revoking a collaborator also clears their active workspace sessions." : "Le modifiche si applicano alla richiesta successiva; la revoca chiude anche le sessioni attive sul tuo workspace."} />
      {data.collaborators.length === 0 ? <EmptyState title={en ? "No collaborators yet" : "Nessun collaboratore"} description={en ? "Invite someone to work together." : "Invita qualcuno per lavorare insieme."} /> :
      <div className="collaborator-list">{data.collaborators.map((item) => <div className="collaborator-row" key={item.id}>
        <div className="collaborator-identity"><strong>{item.user.displayName}</strong><span>{item.user.email}</span></div>
        <Select aria-label={en ? "Collaborator role" : "Ruolo collaboratore"} value={item.role} disabled={busy} onChange={(event) => void updateRole(item.id, event.target.value as Role)}>{roleOptions.map((value) => <option key={value} value={value}>{roleNames[value][en ? "en" : "it"]}</option>)}</Select>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => void removeCollaborator(item)}>{en ? "Revoke" : "Revoca"}</Button>
      </div>)}</div>}
    </Panel>

    <Panel>
      <PanelHeader title={en ? "Pending invitations" : "Inviti in attesa"} />
      {data.invitations.length === 0 ? <p className="muted-note">{en ? "There are no pending invitations." : "Non ci sono inviti in attesa."}</p> :
      <div className="collaborator-list">{data.invitations.map((item) => <div className="collaborator-row" key={item.id}>
        <div className="collaborator-identity"><strong>{item.email}</strong><span>{roleNames[item.role][en ? "en" : "it"]} · {en ? "expires" : "scade"} {new Date(item.expiresAt).toLocaleDateString(locale)}</span></div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void revokeInvitation(item)}>{en ? "Revoke invite" : "Revoca invito"}</Button>
      </div>)}</div>}
    </Panel>
    <Panel>
      <PanelHeader title={en ? "Permission summary" : "Riepilogo permessi"} description={en ? "The owner always retains control of billing and financial records." : "Il proprietario mantiene sempre il controllo dell'abbonamento e dei dati economici."} />
      <div className="role-summary">{roleOptions.map((item) => <div key={item}><Badge tone={item === "admin" ? "info" : "neutral"}>{roleNames[item][en ? "en" : "it"]}</Badge><p>{roleDescriptions[item][en ? "en" : "it"]}</p></div>)}</div>
    </Panel>
  </div>;
}
