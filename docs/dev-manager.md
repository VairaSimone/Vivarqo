# Vivarqo Dev Manager

Launcher e supervisore locale per Windows/macOS/Linux. Usa i comandi ufficiali già presenti nel monorepo.

## Avvio

Prerequisiti: Node.js 24.11.x, Corepack/pnpm 10.20 e Docker Desktop/Docker Engine con Compose v2 avviato.

Su Windows: doppio clic su dev-manager.cmd.
Da terminale, nella root: pnpm dev:manager

Il primo avvio crea .env da .env.example se non esiste e genera un CSRF_SECRET casuale. Non sovrascrive un .env esistente. Esegue pnpm install --frozen-lockfile, avvia PostgreSQL dal Compose locale, attende pg_isready, genera Prisma e lancia db:ensure.

Avvia poi API e attende /healthz, worker e frontend e attende Vite su localhost:5173.

## Monitoraggio

- stdout/stderr di ogni processo sono mostrati nel terminale e salvati in file separati.
- API e frontend ricevono health check HTTP ogni 10 secondi; tre controlli consecutivi falliti provocano un riavvio.
- Un processo terminato inaspettatamente viene riavviato con backoff esponenziale, fino a 8 tentativi.
- Log in .dev-manager/logs/.
- Ctrl+C arresta i processi applicativi avviati dal manager. PostgreSQL resta attivo per preservare i dati locali.

Variabili opzionali:
- VIVARQO_API_URL: endpoint health API, default http://127.0.0.1:3000/healthz.
- VIVARQO_WEB_URL: URL frontend, default http://127.0.0.1:5173.

## Limiti della prima versione

È un supervisore per sviluppo locale, non un process manager di produzione. Il worker è monitorato tramite vita del processo e non ha un endpoint HTTP health dedicato. Non riavvia automaticamente Docker/PostgreSQL se il daemon si arresta dopo l'avvio. Le segnalazioni sono nel terminale e nei log, non tramite notifiche toast desktop. Le porte devono essere libere. Non eseguire il launcher contro database di produzione o staging.
