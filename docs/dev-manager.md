# Vivarqo Manager

Un unico entrypoint con due modalità separate: sviluppo locale e supervisione della produzione Linux. La dashboard HTTP ascolta esclusivamente su loopback.

## Windows: sviluppo e test

Prerequisiti: Windows 10/11, Node.js 24.11.x, Corepack/pnpm 10.20 e Docker Desktop con Compose v2 avviato.

Avvio dalla root del repository:

```powershell
pnpm dev:manager
```

Oppure doppio clic su `dev-manager.cmd`.

La modalità predefinita è `development`: crea `.env` da `.env.example` solo se manca, installa le dipendenze, avvia PostgreSQL dal Compose di sviluppo e avvia API, worker e frontend come processi Node. La dashboard è su `http://127.0.0.1:4179`.

Le notifiche desktop Windows vengono inviate tramite PowerShell/.NET WinForms. Funzionano nella sessione desktop interattiva dell'utente: minimizzare il manager non deve interromperle, ma eseguirlo come servizio Windows nella sessione 0 non è supportato. Per provarle davvero mentre il manager resta minimizzato:
1. Avvia `pnpm dev:manager` e minimizza la finestra.
2. Da una seconda PowerShell, esegui:

```powershell
pnpm test:dev-manager:notifications
```

Il drill termina forzatamente il processo API, attende il suo riavvio e chiede conferma della notifica generata dal manager. È una verifica interattiva sul desktop reale, non un test automatico headless.

## Linux: produzione su VPS

La modalità production usa esclusivamente `backend/infra/docker/compose.production.yaml`. Non installa pnpm, non copia file `.env`, non avvia processi Node di sviluppo e **non arresta i container quando il manager viene fermato**. Docker Compose mantiene i servizi attivi e i rispettivi restart policy; il manager li monitora e richiede il ripristino dei container non sani.

Prerequisiti:
- Linux con Docker Engine e Compose v2;
- checkout del repository in una directory stabile;
- file ambiente production e segreti già predisposti secondo la documentazione di deployment;
- utente di servizio autorizzato ad accedere al socket Docker.

Avvio manuale:

```bash
export VIVARQO_MANAGER_MODE=production
export VIVARQO_ENV_FILE=/etc/vivarqo/production.env
node scripts/dev-manager.mjs
```

Il file indicato da `VIVARQO_ENV_FILE` deve valorizzare tutte le variabili richieste dal Compose production, inclusi percorsi dei secret e directory backup. Il manager esegue `docker compose config --quiet` prima di avviare lo stack con `up -d`; Compose costruisce le immagini mancanti, ma il manager non ricostruisce immagini a ogni riavvio. Le migrazioni sono gestite dal servizio Compose `migrate`. Per distribuire una nuova versione, esegui la build/deploy tramite la pipeline o la procedura di rilascio, non tramite il supervisore.

Per un VPS, esegui il manager tramite systemd così viene riavviato dopo un crash o un reboot. Esempio di unità:

```ini
[Unit]
Description=Vivarqo Production Manager
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=vivarqo
Group=vivarqo
SupplementaryGroups=docker
WorkingDirectory=/opt/vivarqo
Environment=VIVARQO_MANAGER_MODE=production
Environment=VIVARQO_ENV_FILE=/etc/vivarqo/production.env
Environment=VIVARQO_MANAGER_PORT=4179
ExecStart=/usr/bin/node /opt/vivarqo/scripts/dev-manager.mjs
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Adatta utente, percorso repository e percorso Node alla VPS. Dopo aver aggiornato il file unit:

```bash
sudo install -m 0644 deploy/systemd/vivarqo-manager.service /etc/systemd/system/vivarqo-manager.service
sudo systemctl daemon-reload
sudo systemctl enable --now vivarqo-manager
sudo systemctl status vivarqo-manager
journalctl -u vivarqo-manager -f
```

Non esporre la porta 4179 su Internet: resta legata a localhost. Per aprirla dal PC amministratore usa un tunnel SSH:

```bash
ssh -L 4179:127.0.0.1:4179 user@vps
```

Poi visita `http://127.0.0.1:4179` sul PC. Il manager non sostituisce Docker restart policy, systemd, backup monitorati o un sistema di alerting esterno.

## Dashboard, log e diagnostica

- Stato container/processi e contatori di riavvio.
- Log live filtrabili per livello e servizio; cronologia recuperata da `.dev-manager/logs/manager.log`.
- EventSource riconnette automaticamente; al ripristino della connessione ricarica lo snapshot per recuperare gli eventi persi.
- Diagnostica raggruppata: rete/timeout e database non raggiungibile sono classificati come transitori; un singolo evento non viene promosso a problema persistente.
- Dashboard protetta da bind loopback, controllo dell'indirizzo remoto e validazione dell'header Host.
- Worker verificato tramite heartbeat DB reale: scrittura ogni 10 secondi, TTL 45 secondi.
- PostgreSQL verificato con health check Compose/pg_isready e riavviato senza rimuovere il volume.

## Test

```bash
pnpm check:dev-manager
pnpm test:dev-manager
pnpm test:dev-manager:integration
pnpm test:dev-manager:postgres
pnpm test:dev-manager:production
```

I test d'integrazione di processo e sicurezza vengono eseguiti su Linux e Windows nella CI.

Drill PostgreSQL reale:
- il primo script ferma e riavvia il container e verifica che il volume conservi i dati;
- il secondo avvia il manager in modalità sviluppo isolata, ferma PostgreSQL dall'esterno, verifica il recovery del monitor sviluppo e controlla il dato;
- il terzo avvia la vera modalità production su un Compose temporaneo Linux, esegue le migrazioni di test, ferma PostgreSQL, verifica il recovery del Production Manager, controlla il dato persistente e verifica che arrestare il manager lasci i container attivi.

```bash
VIVARQO_MANAGER_POSTGRES_DRILL=1 bash scripts/dev-manager-postgres-drill.sh
node scripts/dev-manager-postgres-manager.test.mjs
node scripts/dev-manager-production.test.mjs
```

Eseguili solo su un ambiente di sviluppo/test: interrompono temporaneamente le connessioni al database e usano il Compose locale. Non usarli su un database di produzione.

## Limiti da tenere presenti

- Le notifiche visibili richiedono una sessione Windows interattiva e la conferma manuale; GitHub Actions non può dimostrare che un balloon sia apparso sul desktop fisico.
- Il drill PostgreSQL CI verifica un vero container Compose e la persistenza del volume, ma non simula un disco guasto o una corruzione fisica.
- La modalità production monitora lo stato dei container e il heartbeat worker; non sostituisce monitoraggio applicativo di ogni job, backup off-site, restore periodici o alerting esterno.
- La dashboard è locale. Su VPS si accede tramite SSH tunnel, non pubblicando la porta.
- Il manager non deve essere eseguito contemporaneamente in più istanze sulla stessa stack: usare una sola unità systemd.
