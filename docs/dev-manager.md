# Vivarqo Manager — guida operativa

Questa guida spiega come installare, avviare, usare, aggiornare e arrestare il supervisore Vivarqo. Il manager ha due modalità distinte:

- **Development (Windows/Linux):** prepara l'ambiente di sviluppo, installa le dipendenze, avvia PostgreSQL locale e i processi API, worker e frontend.
- **Production (Linux VPS):** avvia e sorveglia lo stack Docker Compose di produzione. Non installa dipendenze Node del progetto e, quando il manager viene fermato, lascia intenzionalmente attivi i container.

> Non usare il Compose di sviluppo su una VPS pubblica. Per il deployment pubblico segui anche [Deployment production/staging](../backend/docs/production-deployment.md): questa guida riguarda il processo manager, non sostituisce la configurazione di dominio, TLS, provider, backup e segreti.

## 1. Windows — prima installazione e primo avvio

### Prerequisiti

Installa e verifica:

- Windows 10/11;
- Git;
- Node.js **24.11.x** (la versione deve essere almeno 24.11 e inferiore a 25);
- Corepack/pnpm 10.20;
- Docker Desktop con Docker Compose v2, avviato e funzionante.

Apri PowerShell e controlla:

```powershell
node --version
corepack --version
docker --version
docker compose version
```

Se pnpm non è già disponibile, abilita Corepack:

```powershell
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm --version
```

### Scaricare il progetto

Se non hai ancora il repository:

```powershell
git clone https://github.com/VairaSimone/Vivarqo.git
cd Vivarqo
```

Se il repository è già presente, entra nella sua cartella e aggiorna il branch:

```powershell
cd C:\percorso\Vivarqo
git switch main
git pull --ff-only origin main
```

### Avviare il manager

Dalla cartella principale del repository:

```powershell
pnpm dev:manager
```

In alternativa fai doppio clic su `dev-manager.cmd`.

Al primo avvio il manager:
1. verifica Node, pnpm e Docker Compose;
2. crea `.env` copiando `.env.example`, solo se il file non esiste, e genera un CSRF secret casuale;
3. esegue `pnpm install --frozen-lockfile`;
4. avvia PostgreSQL tramite `backend/infra/docker/compose.yaml`;
5. genera il client Prisma e verifica/applica lo schema tramite `db:ensure`;
6. avvia API, worker e frontend;
7. apre la dashboard locale.

La preparazione può richiedere diversi minuti al primo avvio perché Docker deve scaricare e/o costruire le immagini e pnpm deve scaricare i pacchetti.

URL predefiniti:
- Dashboard manager: http://127.0.0.1:4179
- Frontend: http://127.0.0.1:5173
- API health: http://127.0.0.1:3000/healthz

La dashboard del manager è separata dall'interfaccia utente di Vivarqo. Se la porta 4179 è già occupata, imposta `VIVARQO_MANAGER_PORT` a una porta libera prima dell'avvio.

### Avvii successivi su Windows

Quando hai già clonato e configurato il progetto:
1. avvia Docker Desktop e attendi che Docker Engine sia pronto;
2. apri PowerShell nella cartella del repository;
3. esegui `pnpm dev:manager` oppure `dev-manager.cmd`;
4. apri http://127.0.0.1:4179.

Non devi cancellare `.env`, reinstallare manualmente le dipendenze o ricreare il database a ogni avvio. Il manager verifica le dipendenze e usa il volume Docker già esistente. Se il progetto è stato aggiornato, fai prima `git pull --ff-only`; il manager non sostituisce la procedura di aggiornamento del codice.

### Arrestare lo sviluppo

Premi `Ctrl+C) nella finestra del manager. Il manager termina API, worker, frontend e i processi figli che ha avviato; chiude la dashboard. PostgreSQL resta attivo nel container e i dati persistenti non vengono cancellati.

Per arrestare anche PostgreSQL, fallo esplicitamente dalla cartella repository:

```powershell
docker compose -f backend/infra/docker/compose.yaml stop postgres
```

Per riavviarlo:

```powershell
docker compose -f backend/infra/docker/compose.yaml start postgres
```

**Non usare `docker compose down -v` se vuoi conservare il database:** l'opzione `-v` elimina i volumi.

## 2. Linux VPS — installazione da zero

La modalità production del manager è supportata su Linux. La VPS deve essere già predisposta con DNS, firewall, Docker, segreti e configurazione production. Il manager non configura da solo account cloud, DNS, certificati, bucket S3 o credenziali provider.

### 2.1 Prerequisiti host

Predisponi una VPS Linux supportata dal provider, con:
- accesso SSH amministrativo;
- DNS del dominio puntato all'indirizzo pubblico della VPS;
- porte TCP 80 e 443 raggiungibili da Internet per Caddy/HTTPS;
- porta SSH accessibile solo dagli indirizzi amministrativi quando possibile;
- Docker Engine e Docker Compose v2;
- Git;
- Node.js 24.11.x;
- un filesystem/volume dedicato per i backup, distinto dal Docker data root.

Non pubblicare le porte 5432, 3000, 8080 o 4179 sul firewall. Il manager espone la dashboard soltanto su `127.0.0.1`.

Verifica le versioni:

```bash
node --version
docker --version
docker compose version
git --version
```

Il processo systemd usa l'eseguibile Node indicato in `ExecStart`: verifica il percorso con `command -v node` e correggi l'unità se non è `/usr/bin/node`.

### 2.2 Creare utente e directory

Esempio con utente di servizio `vivarqo` e repository in `/opt/vivarqo`:

```bash
sudo groupadd --system vivarqo 2>/dev/null || true
sudo useradd --system --create-home --gid vivarqo --shell /usr/sbin/nologin vivarqo 2>/dev/null || true
sudo usermod -aG docker vivarqo

sudo install -d -o vivarqo -g vivarqo -m 0750 /opt/vivarqo
sudo install -d -o root -g root -m 0700 /etc/vivarqo/prod/secrets
```

L'accesso al gruppo `docker` equivale, nella pratica, a privilegi root sull'host: concedilo solo all'account di servizio che deve gestire i container. Dopo aver modificato i gruppi, le nuove sessioni devono ricaricare l'appartenenza.

Clona il repository:

```bash
sudo -u vivarqo git clone https://github.com/VairaSimone/Vivarqo.git /opt/vivarqo
cd /opt/vivarqo
sudo -u vivarqo git switch main
```

### 2.3 Creare i segreti

Genera le password DB e il CSRF secret:

```bash
sudo /opt/vivarqo/backend/scripts/init-production-secrets.sh /etc/vivarqo/prod/secrets
```

Lo script crea:
- `postgres_admin_password`
- `postgres_app_password`
- `postgres_backup_password`
- `csrf_secret`

Devi inoltre provisionare tramite secret manager o procedura sicura i seguenti file, con i valori reali dei provider:

- `resend_api_key`
- `stripe_secret_key`
- `stripe_webhook_secret`
- `vapid_private_key`
- `s3_access_key_id`
- `s3_secret_access_key`

Imposta i file dei provider a permesso `0444`, mantenendo la directory root-owned a permesso `0700):

```bash
sudo chmod 0444 /etc/vivarqo/prod/secrets/*
sudo chown root:root /etc/vivarqo/prod/secrets
sudo chmod 0700 /etc/vivarqo/prod/secrets
```

Usa credenziali e risorse **Live** per Stripe solo in produzione. Non mettere mai i valori segreti nel repository, in `.env.production`, nei log o nei comandi salvati nella history della shell. Per staging usa directory, database, bucket, dominio e chiavi Stripe Test completamente separati.

### 2.4 Preparare il volume backup

Monta un disco/volume persistente dedicato, ad esempio su `/mnt/vivarqo-prod-backups`. Configura il mount in `/etc/fstab` o tramite il sistema del provider, così sarà disponibile anche dopo il reboot.

Crea il mountpoint e verifica che sia realmente montato:

```bash
sudo mkdir -p /mnt/vivarqo-prod-backups
sudo /opt/vivarqo/backend/scripts/verify-production-backup-mount.sh /mnt/vivarqo-prod-backups
```

Il controllo rifiuta una directory che non sia un mountpoint o che condivida il filesystem con il Docker data root. Non proseguire se il controllo fallisce. Il backup locale su disco separato non è ancora un backup off-site: configura anche replica cifrata su un secondo account/regione e prove di restore su un host indipendente.

### 2.5 Configurare l'ambiente production

Copia il modello non segreto:

```bash
sudo install -o vivarqo -g vivarqo -m 0600 /opt/vivarqo/.env.production.example /etc/vivarqo/production.env
sudoedit /etc/vivarqo/production.env
```

Nel file `/etc/vivarqo/production.env`, imposta **`VIVARQO_ENV_FILE=/etc/vivarqo/production.env`** (perché il Compose deve caricare lo stesso file anche come environment file dei container) e configura almeno:

- `COMPOSE_PROJECT_NAME=vivarqo-prod`
- `VIVARQO_NODE_ENV=production`
- `VIVARQO_SECRETS_DIR=/etc/vivarqo/prod/secrets`
- `VIVARQO_BACKUP_DIR=/mnt/vivarqo-prod-backups`
- `PUBLIC_DOMAIN`, `ACME_EMAIL`, `APP_ORIGIN`, `API_ORIGIN`
- `TRUST_PROXY_HOPS=2` per la catena Caddy → Nginx → API prevista dal Compose;
- `DATABASE_NAME`, `DATABASE_ADMIN_USER`, `DATABASE_USER`, `DATABASE_BACKUP_USER`;
- `EMAIL_FROM`, `STRIPE_PRICE_ID`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`;
- `S3_REGION`, `S3_BUCKET` e `S3_ENDPOINT` se il provider lo richiede;
- retention e intervallo backup.

Sostituisci tutti i valori di esempio: dominio, email, Price ID, chiave VAPID pubblica e bucket devono essere reali. Configura DNS e account S3 prima dell'avvio. Le credenziali private rimangono nei file della directory `VIVARQO_SECRETS_DIR`, non nel file environment.

Verifica proprietà e permessi:

```bash
sudo chown vivarqo:vivarqo /etc/vivarqo/production.env
sudo chmod 0600 /etc/vivarqo/production.env
```

### 2.6 Validare Compose e avviare lo stack la prima volta

Esegui i comandi come utente `vivarqo`, dalla root del repository:

```bash
cd /opt/vivarqo
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml config --quiet
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml up -d
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml ps
```

Il comando `config --quiet` deve terminare senza errori: se fallisce, non avviare il servizio. `up -d` costruisce le immagini necessarie se non sono ancora disponibili, avvia PostgreSQL, esegue le migrazioni e porta su API, worker, web, Caddy e backup secondo le dipendenze definite nel Compose.

Controlla i log iniziali:

```bash
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml logs --tail=200 postgres migrate api worker web caddy backup
```

Verifica che:
- PostgreSQL sia healthy;
- `migrate` termini con exit code 0;
- API e web risultino healthy;
- Caddy abbia ottenuto il certificato HTTPS;
- il servizio backup sia in esecuzione e scriva sul mount dedicato.

### 2.7 Installare e avviare systemd

Il repository contiene `deploy/systemd/vivarqo-manager.service`. Il file predefinito assume:
- repository in `/opt/vivarqo`;
- utente/gruppo `vivarqo`;
- Node in `/usr/bin/node`;
- environment file in `/etc/vivarqo/production.env`.

Se uno di questi percorsi è diverso, modifica il file prima di installarlo. Poi:

```bash
sudo install -m 0644 /opt/vivarqo/deploy/systemd/vivarqo-manager.service /etc/systemd/system/vivarqo-manager.service
sudo systemctl daemon-reload
sudo systemctl enable --now vivarqo-manager
sudo systemctl status vivarqo-manager
```

Da questo momento systemd avvia il manager al boot e lo riavvia se il processo termina inaspettatamente. Il manager esegue `docker compose up -d`, controlla i container ogni 10 secondi, raccoglie i log e richiede il recupero dei servizi non sani.

**Nota:** l'unità usa `SupplementaryGroups=docker`. Verifica che l'utente esista e che il gruppo `docker` sia installato. Il manager deve essere eseguito in una sola istanza per stack.

### 2.8 Aprire la dashboard dalla propria postazione

La dashboard non è pubblicata su Internet e non va esposta tramite Caddy o firewall. Dal PC amministratore apri un tunnel SSH:

```bash
ssh -N -L 4179:127.0.0.1:4179 utente-ssh@IP-DELLA-VPS
```

Lascia il tunnel aperto e visita sul PC:

http://127.0.0.1:4179

Se hai cambiato `VIVARQO_MANAGER_PORT`, usa la stessa porta sia nel tunnel sia nell'URL. Chiudendo il tunnel non arresti il manager o i servizi Vivarqo.

## 3. Utilizzo quotidiano sulla VPS

### Avvio e stato

Con systemd abilitato, dopo un reboot non devi lanciare manualmente il manager:

```bash
sudo systemctl status vivarqo-manager
sudo systemctl start vivarqo-manager
sudo systemctl restart vivarqo-manager
```

- `start`: avvia il manager se è fermo.
- `restart`: riavvia il manager; i container production restano attivi e vengono riadottati dal manager.
- `status`: mostra lo stato dell'unità systemd.

### Arresto

```bash
sudo systemctl stop vivarqo-manager
```

Questo arresta **solo il supervisore e la dashboard**. Non arresta API, worker, frontend, PostgreSQL, Caddy o backup: i container restano gestiti da Docker e dalle rispettive restart policy.

Per fermare intenzionalmente lo stack applicativo durante una manutenzione:

```bash
cd /opt/vivarqo
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml stop
```

Per riavviarlo:

```bash
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml up -d
sudo systemctl start vivarqo-manager
```

Non usare `down -v` come comando di arresto ordinario: rimuove i volumi e può distruggere database e file privati.

### Consultare log e diagnostica

Log del manager e systemd:

```bash
sudo journalctl -u vivarqo-manager -f
sudo journalctl -u vivarqo-manager --since "1 hour ago"

tail -f /opt/vivarqo/.dev-manager/logs/manager.log
```

Log dei container:

```bash
cd /opt/vivarqo
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml ps
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml logs --tail=200 api worker postgres
```

La dashboard mostra:
- stato dei servizi e dettagli dell'ultimo controllo;
- numero di riavvii richiesti dal manager;
- log live e filtri per livello/servizio;
- diagnostica raggruppata;
- aggiornamenti automatici e riconnessione SSE.

I log persistenti del manager si trovano in `.dev-manager/logs/manager.log`; la dashboard mostra gli ultimi record disponibili. I log Docker restano consultabili con `docker compose logs`.

### Cosa fa il manager in automatico

- controlla lo stato dei container production;
- tenta il recupero dei container mancanti o non sani, con intervallo minimo tra i tentativi;
- verifica l'heartbeat worker nel database e tenta il riavvio se risulta assente/scaduto;
- registra eventi e diagnostica;
- mantiene la dashboard disponibile solo su loopback.

Non sostituisce backup off-site, monitoraggio del provider, alerting esterno, aggiornamento sicuro delle immagini o prove periodiche di disaster recovery.

## 4. Aggiornare Vivarqo senza perdere i dati

Prima di aggiornare:
1. verifica che il backup PostgreSQL più recente sia valido;
2. verifica la replica off-site e che gli oggetti S3 siano protetti;
3. pianifica una finestra di manutenzione.

Poi, come utente `vivarqo`:

```bash
cd /opt/vivarqo
git fetch origin
git switch main
git pull --ff-only origin main

docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml config --quiet
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml build
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml up -d
sudo systemctl restart vivarqo-manager
```

Controlla poi:

```bash
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml ps
docker compose --env-file /etc/vivarqo/production.env -f backend/infra/docker/compose.production.yaml logs --tail=200 migrate api worker web caddy
sudo systemctl status vivarqo-manager
```

Non fare `git pull` o build direttamente su una VPS senza una procedura di rilascio e backup. Per deployment più strutturati, usa una pipeline CI/CD con immagini versionate e rollback. Il manager non effettua deploy del nuovo codice da solo.

## 5. Windows — notifiche desktop in background

Le notifiche sono mostrate tramite PowerShell/.NET WinForms e richiedono una sessione desktop Windows interattiva. Minimizzare la finestra del manager è supportato; eseguirlo come servizio Windows in Session 0 non lo è.

Per un test reale:
1. avvia `pnpm dev:manager`;
2. minimizza la finestra;
3. apri una seconda PowerShell nella root del repository;
4. esegui:

```powershell
pnpm test:dev-manager:notifications
```

Il test termina forzatamente il processo API, attende che il manager lo riavvii e chiede conferma visiva della notifica. Se non compare, controlla le impostazioni notifiche di Windows e Non disturbare.

## 6. Comandi di test e drill

Dalla root del repository:

```bash
pnpm check:dev-manager
pnpm test:dev-manager
pnpm test:dev-manager:integration
pnpm test:dev-manager:postgres
pnpm test:dev-manager:production
```

I test PostgreSQL e production sono distruttivi **solo per le risorse temporanee di test che creano**: usano Docker Compose e devono essere eseguiti su una macchina di sviluppo/CI, mai puntandoli a un ambiente production. Non eseguire test di resilienza su un database con dati reali.

## 7. Risoluzione problemi

| Problema | Controlli e azioni |
|---|---|
| Docker non disponibile | Avvia Docker Desktop su Windows; su VPS controlla `systemctl status docker` e `docker info`. |
| pnpm non trovato (sviluppo) | `corepack enable` e `corepack prepare pnpm@10.20.0 --activate`. |
| Porta dashboard occupata | Imposta `VIVARQO_MANAGER_PORT` su una porta libera e riavvia il manager. |
| PostgreSQL non diventa ready | Controlla `docker compose logs postgres`, spazio disco e stato del volume. Non cancellare il volume come tentativo di riparazione. |
| API/frontend non partono | Controlla dashboard, `.dev-manager/logs` e `docker compose logs` (su production). Verifica prima configurazione e dipendenze. |
| systemd entra in restart loop | `journalctl -u vivarqo-manager -n 200 --no-pager`; controlla percorso Node, permessi del repository, environment file e accesso al socket Docker. |
| Production Compose config fallisce | Esegui `docker compose ... config --quiet`; controlla tutte le variabili obbligatorie e l'esistenza dei file secret. |
| Dashboard VPS non raggiungibile | Verifica `systemctl status vivarqo-manager`, la porta locale e il tunnel SSH. Non aprire 4179 nel firewall. |
| Backup non parte | Verifica mountpoint, spazio libero, permessi e log del servizio `backup`. La directory backup deve essere un filesystem separato. |

## 8. Sicurezza e limiti operativi

- La dashboard ascolta su `127.0.0.1`, controlla l'indirizzo remoto e valida l'header Host. Non configurare un reverse proxy pubblico verso la porta 4179.
- Per accesso remoto usa SSH tunnel e proteggi l'accesso SSH con chiavi, utenti autorizzati e firewall.
- Il gruppo Docker concede privilegi equivalenti a root.
- Non cancellare i volumi Docker per risolvere errori di avvio.
- Il manager non è un sistema di backup e non garantisce da solo il disaster recovery.
- Le notifiche desktop sono una funzione Windows; su Linux la supervisione è affidata a systemd, log e strumenti esterni di alerting.
- La modalità production è supportata solo su Linux. Non eseguire `VIVARQO_MANAGER_MODE=production` su Windows.
- Esegui una sola istanza del manager per ogni stack Compose.

Per configurazione completa di staging/production, segreti, rete, S3, TLS e backup: [backend/docs/production-deployment.md](../backend/docs/production-deployment.md).
