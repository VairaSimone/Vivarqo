# Guida operativa — backup, restore, Stripe Test Mode e Web Push

Questa guida separa i controlli ripetibili in CI dalle prove che richiedono credenziali, provider e browser reali. Gli script live sono opt-in e non devono essere eseguiti contro account o dispositivi di produzione.

## 1. Backup PostgreSQL

`pnpm db:backup` crea un dump PostgreSQL custom con `pg_dump`, ne verifica la leggibilità con `pg_restore --list` e scrive un checksum SHA-256. Dump e checksum hanno permessi locali restrittivi.

```bash
DATABASE_URL='postgresql://...' BACKUP_DIR='./backups' pnpm db:backup
```

La copia deve essere trasferita in storage cifrato, separato dal cluster, con accessi limitati. Lo script applica una retention locale tramite `BACKUP_RETENTION_DAYS`; retention off-site, immutabilità, cifratura della copia esterna e gestione chiavi restano responsabilità dell'infrastruttura.

### Pianificazione systemd opzionale

Sono disponibili template per un host Linux dedicato in `backend/systemd/vivarqo-backup.service` e `backend/systemd/vivarqo-backup.timer`. Prima dell'installazione, adattare `/opt/vivarqo/app`, l'utente/gruppo `vivarqo`, il percorso Node.js e `/var/backups/vivarqo`. Creare `/etc/vivarqo/backup.env` con `DATABASE_URL`, permessi `root:vivarqo` e modalità `0640`. Il ruolo DB deve poter leggere tutti i dati necessari al dump.

```bash
sudo install -m 0644 backend/systemd/vivarqo-backup.service /etc/systemd/system/
sudo install -m 0644 backend/systemd/vivarqo-backup.timer /etc/systemd/system/
sudo install -d -o vivarqo -g vivarqo -m 0700 /var/backups/vivarqo
sudo systemctl daemon-reload
sudo systemctl enable --now vivarqo-backup.timer
sudo systemctl start vivarqo-backup.service
sudo systemctl status vivarqo-backup.service
```

Il timer crea una copia locale giornaliera; non equivale a un backup off-site e non sostituisce un disaster-recovery drill.

## 2. Restore manuale protetto

`pnpm db:restore` richiede conferma esplicita, dump custom-format e sidecar SHA-256. Rifiuta il restore se il target contiene oggetti nello schema `public`, non usa `pg_restore --clean` e non cancella dati.

```bash
CONFIRM_RESTORE=YES DATABASE_URL='postgresql://.../database_vuoto' \
  pnpm db:restore ./backups/vivarqo-<timestamp>.dump
```

Usare un database dedicato e vuoto. Prima di un ripristino operativo verificare il cluster selezionato e disporre di uno snapshot/backup del target.

## 3. Restore drill automatico e staging

`pnpm db:restore:drill` crea un dump custom, verifica archivio e checksum, crea un database temporaneo `vivarqo_restore_drill_...`, ripristina la copia, confronta tabelle/migrazioni/conteggi delle tabelle chiave e infine elimina il database temporaneo.

La CI è configurata per eseguire il drill sul PostgreSQL effimero. Per il cluster staging:
1. crea nelle GitHub Actions secrets il secret `STAGING_DATABASE_URL`;
2. utilizza un ruolo operativo limitato al cluster staging ma autorizzato a `CREATEDB` e `DROP DATABASE` per il database temporaneo;
3. apri Actions → **Staging backup and restore drill** → Run workflow → seleziona `YES`;
4. controlla l'esito del job e conserva data, commit ed esito nel registro operativo.

Il workflow non ripristina sul database sorgente: crea un database temporaneo, vi ripristina la copia e poi lo elimina. Se il provider managed vieta `CREATEDB`, esegui la prova su un cluster staging dedicato con un ruolo temporaneo autorizzato; non usare il database principale come destinazione.

## 4. Stripe Test Mode — prova live

I test automatizzati usano un trasporto Stripe simulato. Non dimostrano che Checkout, Customer Portal o webhook siano configurati correttamente sull'account Stripe del gestore.

```bash
STRIPE_SECRET_KEY='sk_test_...' \
STRIPE_PRICE_ID='price_...' \
APP_ORIGIN='https://staging.example.test' \
STRIPE_TEST_EMAIL='checkout-test@example.invalid' \
STRIPE_TEST_USER_ID='<UUID-ACCOUNT-TECNICO-DI-STAGING>' \
pnpm verify:stripe:test
```

Lo script rifiuta chiavi diverse da `sk_test_`, verifica che il Price sia attivo/ricorrente e crea una sessione Checkout hosted. Completa il flusso nel browser usando metodi di pagamento di test Stripe. Dopo il checkout, ricava il customer ID Test Mode e ripeti il comando con `STRIPE_TEST_CUSTOMER_ID=cus_...` per ottenere una sessione Customer Portal.

Usa account e utenti sacrificabili. Lo script crea una sessione su Stripe Test Mode ma non modifica direttamente il database Vivarqo: l'aggiornamento locale dipende dal webhook firmato.

Per i webhook:
- autentica Stripe CLI sullo stesso account Test Mode;
- inoltra gli eventi all'endpoint staging `/api/v1/webhooks/stripe`;
- configura nello staging il secret `whsec_...` restituito da Stripe CLI, mai quello live;
- completa il Checkout e verifica che il webhook aggiorni l'abbonamento dell'account tecnico;
- prova rinnovo/cancellazione e pagamento fallito, quindi reinvia lo stesso evento e verifica che la deduplicazione impedisca una seconda transizione.

Riferimenti: [Stripe Testing](https://docs.stripe.com/testing) e [Stripe Webhooks](https://docs.stripe.com/webhooks).

## 5. Web Push — prova provider/browser

I test di codice verificano cifratura, formato e gestione delle risposte con un trasporto simulato. Non provano la ricezione su browser reali.

1. Configura nello staging `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT`; conserva la chiave privata in un secret manager.
2. Accedi allo staging con un account tecnico e registra una sottoscrizione browser reale sul dominio HTTPS.
3. Recupera endpoint, `p256dh` e `auth` della sottoscrizione di test; non inserirli in issue, commit o log.
4. Esegui in una sessione sicura:

```bash
PUSH_TEST_ENDPOINT='https://...' \
PUSH_TEST_P256DH='...' \
PUSH_TEST_AUTH='...' \
VAPID_PUBLIC_KEY='...' \
VAPID_PRIVATE_KEY='...' \
VAPID_SUBJECT='mailto:ops@example.test' \
pnpm verify:web-push:live
```

Lo script invia una push cifrata e verifica che il provider la accetti con risposta HTTP 2xx. **L'accettazione del provider non dimostra la visualizzazione sul dispositivo:** conferma manualmente la ricezione nel browser e poi revoca la sottoscrizione di test.

Non usare endpoint o chiavi appartenenti a utenti reali.

## 6. Limiti ed evidenze

- Il backup/restore drill della CI dimostra che gli script possono creare e ripristinare un dump nel PostgreSQL effimero; non verifica cifratura, retention o accessi del backup off-site reale.
- Il drill staging verifica un restore nello stesso cluster, non un disaster recovery completo verso una regione alternativa o un cluster sostitutivo.
- Il test Stripe Test Mode e la prova Web Push restano operazioni manuali con account e dispositivi dedicati.
- Registrare data, ambiente, commit, operatore, esito e anomalie senza conservare segreti o dati personali non necessari.
