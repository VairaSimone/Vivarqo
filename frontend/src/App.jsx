import React, { useEffect, useState } from "react";

const navigation = [
  { id: "Home", label: "Home", icon: "⌂" },
  { id: "Animali", label: "Animali", icon: "♧" },
  { id: "Alimentazioni", label: "Alimentazioni", icon: "◉" },
  { id: "Riproduzioni", label: "Riproduzioni", icon: "✳" },
  { id: "Inventario", label: "Inventario", icon: "▤" }
];

const todayTasks = [
  { time: "09:00", title: "Controllo temperature", detail: "Rack principali", tag: "Routine", tone: "sage" },
  { time: "11:30", title: "Registrare le alimentazioni", detail: "3 animali in programma", tag: "Alimentazione", tone: "amber" },
  { time: "16:00", title: "Verificare incubatrice", detail: "Covata VB-024", tag: "Riproduzione", tone: "lavender" }
];

function ApiStatus() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/readyz", { signal: controller.signal, credentials: "include" })
      .then((response) => setStatus(response.ok ? "online" : "offline"))
      .catch((error) => {
        if (error.name !== "AbortError") setStatus("offline");
      });
    return () => controller.abort();
  }, []);

  const labels = {
    checking: "Verifica API…",
    online: "API collegata",
    offline: "API non raggiungibile"
  };

  return (
    <span className={`api-status api-status--${status}`} role="status">
      <span className="status-dot" aria-hidden="true" />
      {labels[status]}
    </span>
  );
}

function StatCard({ label, value, caption, icon, accent }) {
  return (
    <article className={`stat-card stat-card--${accent}`}>
      <div className="stat-card__top">
        <span className="stat-card__label">{label}</span>
        <span className="stat-card__icon" aria-hidden="true">{icon}</span>
      </div>
      <strong className="stat-card__value">{value}</strong>
      <span className="stat-card__caption">{caption}</span>
    </article>
  );
}

export default function App() {
  const [activeSection, setActiveSection] = useState("Home");
  const dateLabel = new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date());

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" onClick={() => setActiveSection("Home")} aria-label="Vivarqo, vai alla Home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-word">vivarqo<span>.</span></span>
        </a>

        <div className="workspace-label">GESTIONE ALLEVAMENTO</div>
        <nav className="primary-nav" aria-label="Navigazione principale">
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`nav-item ${activeSection === item.id ? "nav-item--active" : ""}`}
              onClick={() => setActiveSection(item.id)}
              aria-current={activeSection === item.id ? "page" : undefined}
            >
              <span className="nav-item__icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "Animali" && <span className="nav-count">32</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="support-card">
            <span className="support-card__eyebrow">UN PICCOLO PROMEMORIA</span>
            <p>La costanza di oggi crea uno storico utile domani.</p>
            <span className="support-card__leaf" aria-hidden="true">✳</span>
          </div>
          <button className="profile-button" type="button" onClick={() => setActiveSection("Impostazioni")}>
            <span className="avatar">VA</span>
            <span className="profile-copy"><strong>Il mio allevamento</strong><small>Account demo</small></span>
            <span className="profile-menu" aria-hidden="true">···</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark" aria-hidden="true"><span /></span>
            <span className="brand-word">vivarqo<span>.</span></span>
          </div>
          <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-separator">/</span><strong>{activeSection}</strong></div>
          <div className="topbar-actions">
            <ApiStatus />
            <button className="icon-button notification-button" aria-label="Notifiche" type="button">
              <span aria-hidden="true">♧</span><i />
            </button>
          </div>
        </header>

        <div className="page-wrap">
          <div className="demo-notice">
            <span className="demo-notice__dot" />
            Interfaccia iniziale · contenuti dimostrativi, non sono dati reali
          </div>

          {activeSection === "Home" ? (
            <>
              <section className="welcome-row">
                <div>
                  <p className="eyebrow">{dateLabel}</p>
                  <h1>Il tuo allevamento,<br /><span>sotto controllo.</span></h1>
                  <p className="welcome-copy">Tieni traccia delle attività e prenditi cura dei tuoi animali, un giorno alla volta.</p>
                </div>
                <div className="welcome-art" aria-hidden="true">
                  <div className="art-sun" />
                  <div className="art-leaf art-leaf--one" />
                  <div className="art-leaf art-leaf--two" />
                  <div className="art-pot"><span /></div>
                </div>
              </section>

              <section className="stats-grid" aria-label="Panoramica allevamento">
                <StatCard label="Animali registrati" value="32" caption="Nel tuo allevamento" icon="♧" accent="green" />
                <StatCard label="Attività di oggi" value="04" caption="1 da completare subito" icon="◷" accent="orange" />
                <StatCard label="Covate attive" value="03" caption="In monitoraggio" icon="✳" accent="purple" />
                <StatCard label="Scorte da verificare" value="02" caption="Sotto la soglia minima" icon="▤" accent="blue" />
              </section>

              <div className="content-grid">
                <section className="panel tasks-panel">
                  <div className="panel-heading">
                    <div><p className="eyebrow">LA TUA GIORNATA</p><h2>Da fare oggi</h2></div>
                    <button className="text-button" type="button" onClick={() => setActiveSection("Alimentazioni")}>Vedi attività <span aria-hidden="true">↗</span></button>
                  </div>
                  <div className="task-list">
                    {todayTasks.map((task) => (
                      <article className="task-item" key={task.title}>
                        <div className="task-time">{task.time}</div>
                        <div className={`task-symbol task-symbol--${task.tone}`} aria-hidden="true">•</div>
                        <div className="task-copy"><strong>{task.title}</strong><span>{task.detail}</span></div>
                        <span className={`task-tag task-tag--${task.tone}`}>{task.tag}</span>
                      </article>
                    ))}
                  </div>
                  <button className="add-task-button" type="button" onClick={() => setActiveSection("Alimentazioni")}><span aria-hidden="true">＋</span> Registra un’attività</button>
                </section>

                <section className="panel quick-panel">
                  <div className="panel-heading">
                    <div><p className="eyebrow">ACCESSO RAPIDO</p><h2>Cosa vuoi fare?</h2></div>
                  </div>
                  <button className="quick-action" type="button" onClick={() => setActiveSection("Animali")}>
                    <span className="quick-action__icon quick-action__icon--green" aria-hidden="true">＋</span>
                    <span><strong>Aggiungi un animale</strong><small>Crea una nuova scheda</small></span>
                    <span className="quick-arrow" aria-hidden="true">↗</span>
                  </button>
                  <button className="quick-action" type="button" onClick={() => setActiveSection("Alimentazioni")}>
                    <span className="quick-action__icon quick-action__icon--orange" aria-hidden="true">◉</span>
                    <span><strong>Registra alimentazione</strong><small>Aggiorna lo storico</small></span>
                    <span className="quick-arrow" aria-hidden="true">↗</span>
                  </button>
                  <button className="quick-action" type="button" onClick={() => setActiveSection("Inventario")}>
                    <span className="quick-action__icon quick-action__icon--blue" aria-hidden="true">▤</span>
                    <span><strong>Controlla le scorte</strong><small>Alimenti e materiali</small></span>
                    <span className="quick-arrow" aria-hidden="true">↗</span>
                  </button>
                  <div className="quick-tip"><span aria-hidden="true">✦</span><p><strong>Un consiglio:</strong> registra i dati subito dopo ogni attività per mantenere uno storico completo.</p></div>
                </section>
              </div>
            </>
          ) : (
            <section className="section-placeholder">
              <span className="placeholder-icon" aria-hidden="true">{navigation.find((item) => item.id === activeSection)?.icon ?? "⚙"}</span>
              <p className="eyebrow">PROSSIMO MODULO</p>
              <h1>{activeSection}</h1>
              <p>La struttura di navigazione è pronta. Questa sezione verrà collegata alle API e ai dati reali nei prossimi passaggi.</p>
              <button type="button" className="primary-button" onClick={() => setActiveSection("Home")}>Torna alla Home</button>
            </section>
          )}

          <footer className="page-footer">
            <span>Vivarqo <span className="footer-dot">·</span> Crescere con cura.</span>
            <span>Prima versione dell’interfaccia</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
