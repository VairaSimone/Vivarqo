# Deployment production/staging — Vivarqo

Questa configurazione separa sviluppo locale, staging e produzione. È una configurazione di deployment da applicare su un host reale; il suo inserimento in Git non significa che il servizio sia già stato distribuito.

## Architettura e superficie esposta

Usare `backend/infra/docker/compose.production.yaml` sia per staging sia per produzione, con file environment, progetto Docker, database, segreti e backup distinti. Per impostazione predefinita eseguire staging e produzione su host distinti: entrambe le istanze pubblicano 80/443 tramite Caddy. Per co-localizzarle serve un unico ingress/proxy edge condiviso e una configurazione Caddy centralizzata, non due stack che tentano di occupare le stesse porte.

- Solo Caddy pubblica le porte TCP 80/443 (UDP 443 è opzionale per HTTP/3). Caddy gestisce TLS/ACME e inoltra a Nginx.
- Nginx serve la PWA e inoltra `/api` al backend sulla rete interna `backend`. Solo API e worker sono collegati anche alla rete `egress` per contattare email, Stripe e S3; Nginx, PostgreSQL e il servizio backup non hanno accesso diretto alla rete esterna. L'header `X-Forwarded-Proto` originale viene conservato fino a Express.
- PostgreSQL è solo sulla rete Docker `database`, dichiarata `internal`; non ha porte pubblicate.
- API e worker non pubblicano porte host. Nginx, API e worker comunicano su reti Docker private; API e worker hanno connettività in uscita per email, Stripe e S3.
- Le API e i worker usano il ruolo PostgreSQL applicativo (`vivarqo_app` o l'equivalente staging), senza privilegi amministrativi. Le migrazioni usano il ruolo admin. Il backup usa un terzo account dedicato, membro soltanto del ruolo predefinito `pg_read_all_data` e con attributo `BYPASSRLS`: resta non-superuser e senza privilegi di scrittura, ma può leggere tutte le righe anche quando saranno introdotte policy Row-Level Security. Il ruolo applicativo rimane `NOBYPASSRLS`.
- I file applicativi e i documenti restano in un volume privato; in produzione il backend richiede anche il bucket S3 privato configurato.

Con Caddy → Nginx → Express impostare `TRUST_PROXY_HOPS=2`. Se cambia la catena proxy, ricalcolare il numero; non usare `true` o fiducia indiscriminata negli header forwarded.

## File di configurazione e segreti

`.env.production.example` e `.env.staging.example` contengono soltanto configurazione non segreta. Copiare il file giusto nel root del repository con nome `.env.production` oppure `.env.staging`, proteggerlo con `chmod 600` e non committarlo.

Generare i segreti iniziali:

```bash
sudo backend/scripts/init-production-secrets.sh /etc/vivarqo/prod/secrets
sudo backend/scripts/init-production-secrets.sh /etc/vivarqo/staging/secrets
```

Ogni directory deve rimanere root-owned e mode `0700`. I file sono mode `0444` perché i file-backed secrets di Docker Compose montano i file host senza rimappare uid/gid: così li leggono soltanto i container a cui sono esplicitamente montati. La directory host non è attraversabile da utenti non privilegiati. Non mettere questi file in backup non cifrati o nel repository.

Oltre ai quattro file generati, provisionare tramite secret manager:
- `resend_api_key`
- `stripe_secret_key` (`sk_live_...` in produzione, `sk_test_...` in staging)
- `stripe_webhook_secret`
- `vapid_private_key`
- `s3_access_key_id`
- `s3_secret_access_key`

La chiave VAPID pubblica, il Price ID e le configurazioni dei provider non segrete restano nei rispettivi file environment. Le chiavi, i bucket, gli account Stripe e le directory secret di staging e produzione devono essere distinti.

Il loader applicativo supporta `VARIABLE_FILE`; legge i file a runtime e non inserisce i percorsi *_FILE o i valori dei segreti nell'ambiente del processo. Sia staging sia produzione esigono HTTPS, email, Stripe, VAPID e storage S3 reali; staging rifiuta chiavi Stripe Live e richiede Test Mode, mentre produzione richiede Live Mode. Il container Caddy riceve soltanto dominio pubblico ed email ACME, non l'intera configurazione applicativa. La password DB viene usata per costruire la URL PostgreSQL in memoria. Le chiavi Stripe Test Mode sono rifiutate quando `VIVARQO_NODE_ENV=production`.

## Verifica obbligatoria del filesystem backup

Prima di avviare ogni stack, crea e monta il filesystem dedicato indicato da `VIVARQO_BACKUP_DIR`. Il path deve essere il mountpoint stesso, non una sottocartella sul disco del Docker data root.

```bash
sudo backend/scripts/verify-production-backup-mount.sh /mnt/vivarqo-staging-backups
sudo backend/scripts/verify-production-backup-mount.sh /mnt/vivarqo-prod-backups
```

Il controllo richiede un mountpoint e rifiuta lo stesso device filesystem del Docker data root. Se staging e produzione sono su host differenti, eseguilo su ciascun host. Questo dimostra la separazione locale; non sostituisce replica off-site cifrata e restore drill su un host indipendente.

## Avvio staging

```bash
cp .env.staging.example .env.staging
chmod 600 .env.staging
# Modificare dominio, email, bucket, path e provider; provisionare i segreti staging.
docker compose --env-file .env.staging -f backend/infra/docker/compose.production.yaml config --quiet
docker compose --env-file .env.staging -f backend/infra/docker/compose.production.yaml up -d --build
docker compose --env-file .env.staging -f backend/infra/docker/compose.production.yaml ps
```

Usare un dominio staging con DNS verso l'host e porte 80/443 raggiungibili. Eseguire su staging i test email, Stripe Test Mode/webhook, Web Push reale, upload/download S3, cancellazione account e backup/restore.

## Avvio produzione

```bash
cp .env.production.example .env.production
chmod 600 .env.production
# Modificare dominio, email, bucket, path e Price ID; provisionare i segreti live.
docker compose --env-file .env.production -f backend/infra/docker/compose.production.yaml config --quiet
docker compose --env-file .env.production -f backend/infra/docker/compose.production.yaml up -d --build
docker compose --env-file .env.production -f backend/infra/docker/compose.production.yaml ps
docker compose --env-file .env.production -f backend/infra/docker/compose.production.yaml logs -f caddy api worker backup
```

Il firewall del provider e dell'host deve consentire pubblicamente solo 80/443 e l'accesso SSH amministrativo limitato. Non aprire 5432, 3000 o 8080. Caddy ottiene e rinnova i certificati automaticamente quando DNS e porte sono corretti.

## Backup degli oggetti S3

Il servizio `backup` descritto sopra esegue **soltanto il backup PostgreSQL**. Non copia i documenti, le immagini o gli altri oggetti presenti in `S3_BUCKET`: questi dati vivono fuori dal database.

Prima del lancio, configurare direttamente sul provider S3-compatible:
- Bucket di origine privato, cifratura server-side abilitata e access log/monitoraggio degli accessi.
- Versioning del bucket e protezione contro cancellazioni/overwrite accidentali.
- Replica o backup cifrato verso un secondo account e/o una seconda regione, con policy e credenziali indipendenti.
- Retention coerente con la policy approvata e con quella del database; evitare che la normale retention o un lifecycle cancelli tutte le versioni recuperabili.
- Test di ripristino di un oggetto usando la sua `storageKey` e verifica che il documento associato nel database ripristinato sia nuovamente scaricabile.

Il ruolo S3 usato da API/worker deve essere limitato al bucket applicativo e alle operazioni necessarie al runtime. La replica/backup deve usare credenziali separate: non riutilizzare le chiavi applicative per amministrare il bucket di destinazione. La copia locale PostgreSQL, il versioning S3 e la replica off-site devono essere monitorati come tre controlli distinti.

Non considerare completo il disaster recovery finché non sono stati provati insieme il ripristino del database e il recupero degli oggetti S3 corrispondenti allo stesso punto temporale. Il checksum SHA-256 dei dump PostgreSQL verifica l'integrità dell'archivio, ma non cifra i backup: il filesystem locale dei dump deve essere cifrato a riposo e la copia off-site deve usare cifratura end-to-end o del client di backup.

## Deploy manuale tramite GitHub Actions

Il workflow `.github/workflows/deploy-production.yml` è intenzionalmente solo `workflow_dispatch`: un push su `main` non distribuisce automaticamente. Il job usa l'environment GitHub `production`; configura eventuali required reviewers nelle impostazioni del repository prima di abilitarlo.

Provisionare sul server un checkout Git in `/opt/vivarqo/app`, con remote `origin` puntato al repository. L'utente SSH di deploy deve poter leggere il repository Git (chiave deploy read-only o credenziale equivalente), aggiornare il checkout e usare Docker Compose. L'utente deve avere accesso ai file `.env.production` e alle directory configurate, ma non deve poter modificare segreti condivisi da altri servizi. L'accesso al gruppo Docker equivale di fatto a privilegi root: non esporre il socket Docker a utenti non fidati. Configurare questi GitHub Actions secrets:

- `VIVARQO_DEPLOY_HOST`: hostname/IP del VPS.
- `VIVARQO_DEPLOY_USER`: utente SSH di deploy.
- `VIVARQO_DEPLOY_SSH_KEY`: chiave privata dedicata, senza passphrase oppure gestita da un agente compatibile.
- `VIVARQO_DEPLOY_KNOWN_HOSTS`: riga host key verificata fuori banda (non usare `ssh-keyscan` durante il deploy).
- `VIVARQO_PUBLIC_DOMAIN`: dominio TLS configurato in `.env.production`.

Avviare da Actions → Vivarqo production deployment → Run workflow e incollare lo SHA completo di un commit già raggiungibile da `origin/main`. Il workflow rifiuta SHA non validi o non appartenenti alla storia di `main`.

Il deploy:
1. aggiorna il checkout al commit selezionato e valida la configurazione Compose;
2. verifica che il percorso backup configurato sia un mountpoint;
3. produce un dump PostgreSQL pre-deploy, ne verifica la leggibilità con `pg_restore --list` e calcola il checksum;
4. costruisce le immagini prima di fermare/ricreare i servizi;
5. esegue il servizio one-shot `migrate`; se la migrazione fallisce, non avvia la nuova API;
6. aggiorna i servizi e attende `/readyz` tramite HTTPS.

**Le migrazioni Prisma non vengono annullate automaticamente.** Prima di ogni rilascio, revisionare il SQL delle nuove migration e applicare la strategia expand/contract: aggiungere prima strutture compatibili, distribuire codice che supporti vecchio e nuovo schema, migrare i dati, rimuovere colonne/indici solo in un rilascio successivo. Evitare rename/drop o cambi di tipo incompatibili nello stesso deploy. Il dump pre-deploy è una rete di sicurezza, non un rollback automatico né garanzia di compatibilità. Se readiness fallisce dopo una migration, il workflow mostra log e stato ma non tenta un ripristino distruttivo del database.

## Backup PostgreSQL off-site cifrato con Restic

Il backup Compose continua a creare dump locali verificati su `VIVARQO_BACKUP_DIR`. Per replicarli fuori dal VPS, installare Restic sul server e usare il nuovo script `backend/scripts/backup-offsite-restic.sh`. Restic cifra e autentica i dati sul client prima dell'upload: il provider remoto non riceve dump in chiaro.

Creare un repository remoto dedicato (ad esempio un bucket S3-compatible o un repository Restic su storage remoto) e inizializzarlo una sola volta, in modo interattivo e controllato:

```bash
sudo bash -c 'set -a; . /etc/vivarqo/offsite-backup.env; set +a; restic init'
```

Creare `/etc/vivarqo/offsite-backup.env`, root-owned e mode `0600`, con almeno:

```dotenv
VIVARQO_BACKUP_DIR=/mnt/vivarqo-prod-backups
RESTIC_REPOSITORY=s3:https://s3.eu-central-003.backblazeb2.com/vivarqo-backups
RESTIC_PASSWORD_FILE=/etc/vivarqo/restic-repository-password
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Per un endpoint diverso, sostituire URL e variabili richieste dal backend Restic scelto. La password Restic deve essere generata casualmente, salvata in un secret manager e custodita anche in una copia offline sicura: senza di essa il repository non è recuperabile. Non inserirla nel repository Git, nei log o in un backup non cifrato. Limitare le credenziali remote al bucket dedicato; se il provider supporta versioning/Object Lock, abilitarli con una retention coerente e credenziali amministrative separate.

Installare il timer:

```bash
sudo install -m 0644 backend/systemd/vivarqo-offsite-backup.service /etc/systemd/system/
sudo install -m 0644 backend/systemd/vivarqo-offsite-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vivarqo-offsite-backup.timer
sudo systemctl start vivarqo-offsite-backup.service
sudo systemctl status vivarqo-offsite-backup.service
```

Il servizio verifica anche che `/mnt/vivarqo-prod-backups` sia ancora un mountpoint e ha un timeout di sei ore, così un controllo Restic non viene terminato dopo il timeout breve predefinito di systemd. La prima esecuzione non inizializza il repository automaticamente: fallisce se `restic init` non è stato eseguito, evitando di creare per errore un repository nuovo al posto di quello esistente. Il job mantiene 7 snapshot giornalieri, 5 settimanali e 12 mensili, quindi esegue prune e un controllo del repository. Monitorare `systemctl status`, i log e lo spazio/quote del provider; un timer attivo non dimostra che gli upload siano riusciti.

Il backup Restic copre i dump PostgreSQL locali e i relativi checksum. **Non copia gli oggetti del bucket applicativo S3**: configurare versioning e replica/backup separati per documenti e immagini, con credenziali distinte. Per un disaster recovery reale, effettuare periodicamente un restore drill su un host separato, ripristinando database e oggetti S3 dello stesso punto temporale e verificando i documenti dall'applicazione.

## Database e privilegi

La password admin, quella del ruolo applicativo e quella del ruolo backup sono generate separatamente. All'inizializzazione del volume PostgreSQL, `init-app-role.sh` crea il ruolo app senza privilegi SUPERUSER/CREATEDB/CREATEROLE e gli assegna DML sulle tabelle e uso delle sequenze. Crea anche il ruolo backup, senza privilegi di scrittura o amministrativi, con accesso predefinito `pg_read_all_data`. Le migrazioni usano il ruolo admin perché possono creare tabelle, indici ed estensioni. API e worker usano esclusivamente il ruolo app; il container backup usa esclusivamente il ruolo read-only.

Gli script init PostgreSQL vengono eseguiti soltanto quando il volume dati viene inizializzato per la prima volta. Una rotazione successiva della password app richiede l'aggiornamento coordinato del secret e del ruolo DB prima del riavvio dei servizi; non eliminare il volume per applicare una rotazione.

## Backup e disaster recovery

Il servizio `backup` esegue `pg_dump` giornaliero (intervallo configurabile), valida il dump con `pg_restore --list`, calcola SHA-256 e applica la retention locale. Lo script host `verify-production-backup-mount.sh` rifiuta una directory non montata o sullo stesso device del Docker data root. Il container usa un account database read-only dedicato e non monta la password dell'admin. La directory `VIVARQO_BACKUP_DIR` è un bind mount host indipendente dal volume `postgres-data`; deve essere montata su un secondo disco/volume persistente cifrato a riposo e monitorata per spazio libero.

**La copia su disco separato nello stesso host non è un backup off-site e da sola non basta per il disaster recovery.** Configurare una replica esterna cifrata (secret manager/backup agent aziendale, restic o equivalente) verso un account e una regione separati, verificare i checksum dopo il trasferimento e fare restore drill periodici su un host/cluster differente. Il repository non può creare credenziali o attivare l'off-site senza il provider scelto e i relativi segreti. Non considerare il rilascio pronto finché questa replica e il relativo ripristino non sono provati.

Verificare localmente un dump trasferito:

```bash
cd /mnt/vivarqo-prod-backups
sha256sum -c vivarqo-<timestamp>.dump.sha256
pg_restore --list vivarqo-<timestamp>.dump
```



## Ripristino PostgreSQL da Restic

Il ripristino deve essere eseguito su un host/volume separato, senza sovrascrivere il database di produzione. Installare la stessa versione principale di Restic o una versione compatibile e i client PostgreSQL 18. Recuperare la password Restic dal secret manager offline e predisporre un repository accessibile in sola lettura.

1. Elencare gli snapshot e scegliere esplicitamente quello desiderato:

   ```bash
   sudo bash -c 'set -a; . /etc/vivarqo/offsite-backup.env; set +a; restic snapshots --tag vivarqo --tag postgres'
   ```

2. Creare una directory vuota su un filesystem con spazio sufficiente e ripristinare/verificare i dump:

   ```bash
   sudo install -d -m 0700 /mnt/vivarqo-restore
   sudo env RESTIC_SNAPSHOT='<snapshot-id>' VIVARQO_RESTORE_ROOT=/mnt/vivarqo-restore \
     bash -c 'set -a; . /etc/vivarqo/offsite-backup.env; set +a; exec bash /opt/vivarqo/app/backend/scripts/restore-postgres-restic.sh'
   ```

   Lo script richiede uno snapshot esplicito, rifiuta una directory di destinazione non vuota, verifica tutti i checksum SHA-256 e controlla la leggibilità dei dump con `pg_restore --list`. Non modifica alcun database.

3. Creare un database nuovo e vuoto sul PostgreSQL di ripristino con un ruolo amministrativo. Non puntare mai il comando al database di produzione. Dopo aver individuato il dump corretto nella directory ripristinata:

   ```bash
   createdb --host=<restore-db-host> --username=<restore-admin> vivarqo_restore
   pg_restore --host=<restore-db-host> --username=<restore-admin> \
     --dbname=vivarqo_restore --no-owner --no-acl --exit-on-error \
     /mnt/vivarqo-restore/mnt/vivarqo-prod-backups/<dump-scelto>.dump
   ```

   Se si ripristina su un servizio PostgreSQL remoto, usare un secret manager o `PGPASSFILE` con permessi `0600`; non inserire password nelle opzioni della riga di comando.

4. Eseguire controlli applicativi su un ambiente isolato: migrazioni compatibili, conteggi e relazioni principali, login, accesso a documenti e immagini, processi worker e integrità degli allegati. Conservare log e durata del test. Solo dopo la validazione si può pianificare un cutover separato.

## Strategia operativa per backup e restore S3

Lo storage applicativo usa oggetti privati con chiavi generate e persistite nei record PostgreSQL. Gli oggetti non sono inclusi nei dump del database né nel repository Restic dei dump. Le chiavi sono immutabili e il codice esegue PUT/GET/DELETE sul bucket configurato da `S3_ENDPOINT`, `S3_REGION` e `S3_BUCKET`.

Prima della produzione, applicare sul provider S3-compatible una configurazione equivalente a questa:

- Bucket sorgente privato, accesso pubblico bloccato, TLS obbligatorio e cifratura server-side.
- Versioning abilitato sul bucket sorgente. Conservare le versioni non correnti e i delete marker per un periodo almeno pari alla retention del database; evitare lifecycle che elimini versioni recuperabili prima della scadenza.
- Replica cross-account o backup verso un secondo bucket in un account/credenziali separati, preferibilmente in una regione o provider indipendente. La replica deve includere le versioni nuove e le cancellazioni devono essere configurate in modo da non propagare una cancellazione accidentale in modo irreversibile.
- Se il provider lo supporta, abilitare Object Lock/immutability sul bucket di destinazione con una retention approvata. Le credenziali runtime dell'applicazione non devono poter modificare policy, retention o replica.
- Ruolo runtime dell'applicazione limitato al bucket sorgente e alle sole operazioni oggetto necessarie. Ruolo di replica/backup separato e con permessi minimi; access key distinte da quelle API.
- Monitorare esito e ritardo della replica, errori di autorizzazione, quota/spazio, versioni non replicate e accessi anomali. Un semplice stato "versioning enabled" non dimostra che la replica funzioni.

**Attenzione alle cancellazioni:** il backend invia DELETE per la chiave oggetto. Con versioning S3 questo normalmente crea un delete marker, quindi un GET sulla chiave può continuare a restituire 404 anche se la versione precedente è conservata. Per ripristinare un documento cancellato occorre recuperare la versione precedente e renderla nuovamente corrente (o copiarla su una nuova chiave aggiornando il record DB). Eseguire questa operazione prima o insieme al ripristino del database, mantenendo coerenti record e oggetti.

### Prova periodica di ripristino S3

1. Scegliere uno snapshot DB e il punto temporale corrispondente alla replica S3.
2. Ripristinare il database in un ambiente isolato.
3. Selezionare documenti e immagini campione dai relativi record e leggere le loro `storageKey`.
4. Recuperare le versioni oggetto dal bucket di replica in un bucket di restore isolato; verificare dimensione, MIME e checksum quando disponibili.
5. Rendere disponibili gli oggetti con le chiavi attese dal database ripristinato e verificare download tramite API autenticata e link pubblici autorizzati.
6. Registrare RPO effettivo, tempo di ripristino, oggetti mancanti e correzioni necessarie.

Le API S3-compatible non espongono tutte le stesse funzionalità di versioning, replica, Object Lock e gestione dei delete marker. Il provider effettivo non è specificato nei file di configurazione: prima di scrivere policy automatiche o comandi provider-specifici bisogna identificare il servizio e verificare quali API supporta. Non è corretto dichiarare il backup S3 attivo finché non sono presenti una replica configurata e un restore drill riuscito.
