# Vivarqo Dev Manager

Launcher e supervisore locale per Windows/macOS/Linux. Usa i comandi ufficiali del monorepo.

## Avvio

Prerequisiti: Node.js 24.11.x, Corepack/pnpm 10.20 e Docker Desktop/Docker Engine con Compose v2 avviato.

Su Windows: doppio clic su dev-manager.cmd.
Da terminale, nella root: pnpm dev:manager

La dashboard si apre su http://127.0.0.1:4179. È legata a localhost e non è esposta in rete.

Il primo avvio crea .env da .env.example se non esiste e genera un CSRF_SECRET casuale. Non sovrascrive un .env esistente. Esegue pnpm install --frozen-lockfile, avvia PostgreSQL dal Compose locale, attende pg_isready, genera Prisma e lancia db:ensure.

Avvia poi API e attende /healthz, worker e frontend.

## Dashboard e monitoraggio

- Stato live di PostgreSQL, API, worker e frontend.
- Log live filtrabili e cronologia recente.
- Diagnostica con raggruppamento degli errori ricorrenti e suggerimenti.
- Su Windows gli errori generano una notifica nell'area di notifica tramite PowerShell/.NET WinForms. Le notifiche possono essere disattivate con VIVARQO_DISABLE_TOAST=1.
- Il worker è verificato interrogando il heartbeat DB scritto dal processo worker ogni 10 secondi (TTL 45 secondi).
- PostgreSQL viene controllato con pg_isready. Dopo due controlli falliti il manager prova a ricreare/riavviare il servizio con Docker Compose; riprova periodicamente se resta indisponibile.
- API e frontend ricevono health check HTTP ogni 10 secondi; tre controlli consecutivi falliti provocano un riavvio.
- Processi terminati inaspettatamente vengono riavviati con backoff esponenziale, fino a 8 tentativi.

I log sono in .dev-manager/logs/. Ctrl+C arresta i processi applicativi e chiude la dashboard. PostgreSQL resta attivo e il volume dati non viene cancellato.

Variabili opzionali:
- VIVARQO_MANAGER_PORT: porta dashboard, default 4179.
- VIVARQO_API_URL: endpoint health API, default http://127.0.0.1:3000/healthz.
- VIVARQO_WEB_URL: URL frontend, default http://127.0.0.1:5173.
- VIVARQO_DISABLE_TOAST=1: disattiva notifiche Windows.

## Test

- pnpm check:dev-manager: controllo sintattico.
- pnpm test:dev-manager: test unitari diagnosi/raggruppamento.
- scripts/dev-manager.windows.test.mjs: smoke test Windows per cmd.exe, PowerShell/WinForms e taskkill; eseguito nel job Windows CI.

## Limiti

È un supervisore di sviluppo locale, non un process manager di produzione. Il controllo worker verifica il heartbeat del processo e la connessione DB, non la riuscita funzionale di ogni singolo job. Se Docker Engine è completamente fermo, il manager può solo tentare il comando Compose e segnalare l'errore; non può avviare Docker Desktop in modo affidabile su tutte le configurazioni. Le notifiche Windows richiedono una sessione desktop interattiva. La porta dashboard è vincolata a localhost.
