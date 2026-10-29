# Runbook operativo Vivarqo

**Stato:** runbook da completare per ogni ambiente; non prova da solo che la produzione sia configurata o verificata.

## 1. Ambienti e rilascio

Mantenere almeno development, staging e production separati con database, bucket/credenziali, VAPID keys, Stripe keys, Sentry project e origini applicative indipendenti. Non copiare dati di produzione su staging. Le credenziali non devono essere committate nel repository o inserite nei log.

Prima di un rilascio:
1. revisionare la PR; non distribuire branch non verificati;
2. verificare che CI, test database, TypeScript/frontend build, browser E2E, OpenAPI bundle e CodeQL siano verdi;
3. creare e verificare un backup del DB e valutare la rollback migration;
4. applicare le migration versionate con pnpm db:migrate:deploy (mai usare prisma db push in produzione);
5. distribuire la versione API/frontend compatibile, quindi controllare /healthz, /readyz, login, export, documenti, notifiche e webhook;
6. controllare log e Sentry senza registrare password, cookie, token, URL dei link pubblici o body privati.

Il server non dovrebbe ricevere traffico prima del completamento di migration/schema check e avvio della coda pg-boss. Un mancato avvio della coda deve rendere la release non pronta, non essere trattato come successo.

## 2. Configurazione segreti

Configurare tramite secret manager o file di ambiente accessibile solo al servizio: DATABASE_URL, APP_ORIGIN, API_ORIGIN, CSRF_SECRET; credenziali email transazionali; STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID; S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY ed eventualmente S3_ENDPOINT; VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT; SENTRY_DSN; PRIVATE_STORAGE_PATH solo per sviluppo/test o quando il filesystem privato sia persistente e incluso nel piano backup.

Ruotare i segreti secondo una procedura documentata. Limitare accesso al DB e al bucket con least privilege. Non abilitare un endpoint S3 pubblico; i documenti vanno serviti solo dopo controllo di autenticazione e ownership.

## 3. Regioni UE e fornitori

Il codice non può attestare la località effettiva dei dati. Per ciascun account AWS/S3 compatibile, database, hosting, email, pagamenti, monitoraggio e backup, registrare in un inventario:
- fornitore, prodotto e regione configurata (valore verificato dalla console/API);
- località di replica/backup, sub-responsabili e accessi del supporto;
- DPA/accordo ex art. 28 GDPR e meccanismo per eventuali trasferimenti extra-SEE;
- cifratura in transito/a riposo, key ownership, retention e processo di cancellazione;
- data, evidenza verificabile (screenshot/export/configuration ID) e persona che ha fatto il controllo.

Non indicare 'dati ospitati esclusivamente nell'UE' nell'informativa finché non sono state verificate tutte le copie, inclusi log, backup, email e supporto del fornitore.

## 4. Backup e restore

Il repository include:
- backend/scripts/backup-postgres.sh: dump custom, controllo pg_restore --list, checksum SHA-256 e rotazione locale dopo una nuova copia valida;
- backend/scripts/restore-postgres.sh: controllo checksum/formato e restore senza --clean/drop automatici;
- backend/systemd/vivarqo-backup.service e .timer: template di schedulazione giornaliera.

### Installazione systemd

Gli unit file sono template per un host Linux dedicato. Prima di installarli, adattare /opt/vivarqo/app, utente/gruppo vivarqo, e permessi dei percorsi. Installare gli strumenti client PostgreSQL compatibili col server. Configurare /etc/vivarqo/backup.env con permessi root:vivarqo e 0640; deve contenere almeno DATABASE_URL con un ruolo dedicato che possa leggere tutti i dati necessari. Non includere il file nei deploy o nel repository. Creare /var/backups/vivarqo, assegnarlo all'utente di servizio e verificarne spazio e cifratura del volume.

Comandi operativi (dopo aver adattato e copiato gli unit file):

    sudo install -m 0644 backend/systemd/vivarqo-backup.service /etc/systemd/system/
    sudo install -m 0644 backend/systemd/vivarqo-backup.timer /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now vivarqo-backup.timer
    sudo systemctl start vivarqo-backup.service
    sudo systemctl status vivarqo-backup.service
    sudo journalctl -u vivarqo-backup.service --since today

Il job crea dump solo dopo aver verificato il file, ma il timer non è abilitato dall'applicazione: deve essere installato dall'operatore. I dump locali non sono un'offsite backup; sincronizzare una copia cifrata verso uno storage separato con credenziali e retention indipendenti. Proteggere il database e il bucket privato dai permessi del backup operator. La policy di retention deve considerare la cancellazione richiesta dagli utenti e i vincoli di conservazione: i backup scadono con la rotazione e non vanno usati per reintrodurre dati cancellati in produzione.

### Drill di ripristino

Eseguire periodicamente su un database vuoto isolato, mai sul DB applicativo:
1. verificare checksum e pg_restore --list;
2. creare il DB temporaneo con ruolo autorizzato e senza connessioni applicative;
3. ripristinare con CONFIRM_RESTORE=YES e backend/scripts/restore-postgres.sh;
4. applicare/verificare migration, query di controllo, numero/tipi di tabelle, accesso a indici/estensioni e integrità applicativa;
5. documentare tempo, esito, anomalie, RPO/RTO misurati e pulire il DB temporaneo secondo la procedura autorizzata.

Non segnare il restore come testato finché non esiste un verbale del drill con data e output.

## 5. Stripe Test Mode — procedura verificabile

La CI non usa credenziali Stripe reali e quindi non prova il checkout esterno. Prima di un rilascio:
1. usare chiavi Test Mode sk_test_..., prezzo test e webhook signing secret dell'endpoint staging, mai le chiavi live;
2. creare account test verificato e completare Checkout con una carta di test documentata da Stripe;
3. confermare che il webhook firmato venga accettato, il suo event ID venga salvato una sola volta e lo stato locale sia aggiornato senza duplicati dopo replay;
4. provare checkout abbandonato, pagamento riuscito, rinnovo/aggiornamento, Customer Portal e cancellazione/pending cancellation; provare firma invalida e webhook duplicato;
5. confrontare dashboard Stripe test e DB locale per customer/subscription/price/status; controllare anche past_due, unpaid, paused e account senza subscription quando applicabili;
6. conservare run ID, event ID non sensibili, timestamp, screenshot oscurati e risultati. Non inserire segreti o dati di carta nel report.

## 6. Sentry

Configurare un progetto Sentry per ogni ambiente con SENTRY_DSN. Verificare un errore controllato su staging e accertarsi che il progetto riceva evento, environment e release corretti. Controllare che request bodies, cookie, Authorization, query string e altri dati identificanti non siano trasmessi; mantenere i filtri e limitare accesso, retention e export degli eventi.

## 7. Incidenti e continuità

Prima del lancio assegnare ruoli e contatti per DB/provider, sicurezza, privacy e comunicazioni. Definire escalation, conservazione delle evidenze, procedura per credenziali compromesse, valutazione breach, comunicazione al titolare e, se applicabile, notifica agli interessati/autorità. Stabilire e testare un piano di indisponibilità DB/storage/email/Stripe, e una procedura di rollback per l'API e il frontend.

Questo documento è un runbook tecnico: sostituire i segnaposto, eseguire i drill e far approvare i processi reali. Non è una certificazione legale o di sicurezza.