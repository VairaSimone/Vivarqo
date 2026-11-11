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

