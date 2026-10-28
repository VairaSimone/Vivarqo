# Vivarqo

Vivarqo è una PWA gestionale mobile-first per piccoli e medi allevatori di rettili. Questa prima consegna è intenzionalmente backend-first: mette in piedi il runtime API, il controllo di configurazione, la connessione PostgreSQL, gli endpoint tecnici di health/readiness, la migrazione relazionale di riferimento e i test del perimetro implementato.

## Stack e prerequisiti
- Node.js **24.11+** (linea LTS; vedi `.nvmrc`).
- pnpm 10, abilitato tramite Corepack.
- Docker Engine + Docker Compose per PostgreSQL 18 locale.
- PostgreSQL 18 in ogni ambiente gestito. La migrazione iniziale richiede l'estensione `citext`.

## Avvio locale
Dalla root del repository:

```bash
corepack enable
cp .env.example .env
docker compose -f infra/docker/compose.yaml up -d postgres
pnpm install
pnpm db:generate
pnpm dev:api
```

Questa modalità avvia l'API sul computer e PostgreSQL in Docker. Dopo aver applicato la migrazione, in alternativa puoi eseguire anche l'API in container con:

```bash
docker compose -f infra/docker/compose.yaml up -d --build api
```

La configurazione Compose dell'API legge le variabili da `.env` ma sovrascrive `DATABASE_URL` per usare il servizio `postgres` della rete Docker. Il servizio PostgreSQL crea il database `vivarqo` alla prima inizializzazione; l'API, prima di aprire la porta HTTP, applica automaticamente le migrazioni e verifica la completezza dello schema.

Lo schema SQL consolidato di riferimento è versionato in [`database/schema.sql`](database/schema.sql); le migrazioni incrementali eseguibili sono raccolte in `prisma/migrations/` e il modello ORM in `prisma/schema.prisma`. Per ogni modifica futura aggiungere una nuova migrazione versionata: non modificare una migrazione già applicata e non usare `prisma db push` in produzione.

All'avvio l'API aspetta PostgreSQL, esegue `prisma migrate deploy` e controlla tabelle, colonne, indici, vincoli nominati, trigger, funzioni ed estensione `citext`. Se lo schema SQL completo è già stato applicato manualmente ma manca la cronologia Prisma, l'app lo registra come baseline solo dopo la verifica integrale. Se trova uno schema parziale non tracciato o una migrazione già applicata ma con oggetti mancanti, interrompe l'avvio senza cancellare o sovrascrivere dati: in quel caso va fatto un backup e va corretta la deriva con una migrazione revisionata.

**Il database PostgreSQL indicato in `DATABASE_URL` deve già esistere** (Compose lo crea; nei servizi gestiti va creato nel provider). L'avvio automatico crea/aggiorna lo schema dentro quel database, non crea un server PostgreSQL né un database mancante sul provider. Il comando manuale `pnpm db:migrate:deploy` resta disponibile ed è idempotente.

## Controlli
```bash
pnpm test
pnpm typecheck
pnpm build
curl http://localhost:3000/healthz
curl http://localhost:3000/readyz
```

- `GET /healthz`: liveness, non dipende da PostgreSQL.
- `GET /readyz`: readiness, restituisce 200 solo quando PostgreSQL risponde; altrimenti 503 senza dettagli interni.
- Sono disponibili le API di account, autenticazione e i moduli di dominio descritti sotto. Il frontend React/PWA non è ancora incluso.

## Account e autenticazione

Le rotte implementate in questo incremento sono:

| Metodo | Endpoint | Scopo |
|---|---|---|
| GET | /api/v1/auth/csrf | Emette cookie e token CSRF firmato |
| POST | /api/v1/auth/register | Registra account e invia email di verifica |
| POST | /api/v1/auth/verify-email | Consuma il token di verifica monouso |
| POST | /api/v1/auth/resend-verification | Richiede un nuovo link di verifica |
| POST | /api/v1/auth/login | Autentica e crea una sessione server-side |
| POST | /api/v1/auth/logout | Revoca la sessione corrente |
| POST | /api/v1/auth/sessions/revoke-all | Revoca tutte le sessioni dell'account |
| POST | /api/v1/auth/forgot-password | Richiede il reset password |
| POST | /api/v1/auth/reset-password | Consuma il token e cambia password |
| GET | /api/v1/auth/me | Restituisce il profilo autenticato |
| PATCH | /api/v1/account | Modifica nome, lingua, fuso orario, email o password |

Prima di ogni richiesta mutativa, il client deve chiamare GET /api/v1/auth/csrf e mandare il valore restituito come header X-CSRF-Token, oltre al cookie inviato automaticamente. Usa credentials: include nelle fetch browser. Non salvare session token in localStorage: la sessione è un cookie HttpOnly e nel database ne è conservato solo l'hash. Il token CSRF va tenuto in memoria e rinnovato quando scade.

La password deve avere almeno 12 caratteri. Gli account possono autenticarsi solo dopo la verifica dell'email. Verifica email e reset password usano token casuali monouso con scadenza, salvati esclusivamente come hash.

Per inviare email reali configura RESEND_API_KEY e EMAIL_FROM nel file .env. Se il provider non è configurato o non è raggiungibile, l'errore viene registrato senza includere token o dettagli sensibili; la risposta pubblica resta generica per non rivelare se un indirizzo è registrato. In un ambiente senza provider, le email non saranno consegnate e va usato un sender fittizio solo nei test.

## Configurazione
Copia .env.example in .env. Le chiavi provider sono vuote o segnaposto dimostrativi: non inserire segreti reali nel repository. DATABASE_URL deve essere una URL PostgreSQL valida; APP_ORIGIN è l'origine frontend ammessa da CORS e CSRF_SECRET deve essere una stringa casuale di almeno 32 caratteri.

## Comandi pnpm
| Comando | Scopo |
|---|---|
| `pnpm dev:api` | Avvia l'API in watch mode |
| `pnpm db:generate` | Genera il client Prisma |
| `pnpm db:migrate:deploy` | Applica le migrazioni versionate |
| `pnpm db:migrate:dev` | Crea/applica una migrazione in sviluppo; solo su DB di sviluppo |
| `pnpm test` | Esegue i test API |
| `pnpm typecheck` | Type-check TypeScript |
| `pnpm build` | Compila l'API |

## Stato dell'incremento
Implementato: fondamenta API, account e impostazioni, registrazione, verifica email, login/logout, revoca sessioni, recupero/reset password, sessioni server-side con cookie HttpOnly, CSRF, rate limit dedicato ai flussi auth, integrazione email Resend configurabile e test unitari/integration.

Non ancora implementato: animali e registri di cura, attività e promemoria, riproduzioni, inventario, documenti e condivisioni pubbliche, import/export, finanze, billing Stripe, notifiche/job, OpenAPI completa e frontend React/PWA. La presenza delle tabelle non implica che tali funzionalità siano disponibili.

Le discrepanze note sono annotate in [docs/architecture-decisions.md](docs/architecture-decisions.md). La specifica ricevuta è conservata in [docs/specification.md](docs/specification.md).

## Anagrafiche animali e registri di cura

Le API di questo incremento sono private: richiedono una sessione valida e, per le richieste mutative da browser, il token CSRF ottenuto da `GET /api/v1/auth/csrf`. Tutte le query di dominio filtrano per proprietario; una risorsa di un altro account risponde come non trovata.

### Animali

| Metodo | Endpoint | Funzione |
|---|---|---|
| GET | `/api/v1/animals` | Lista paginata, ricerca per nome/codice, filtri e ordinamento |
| POST | `/api/v1/animals` | Crea un animale |
| POST | `/api/v1/animals/bulk` | Crea fino a 500 animali in un'unica transazione |
| GET | `/api/v1/animals/:id` | Dettaglio |
| PATCH | `/api/v1/animals/:id` | Modifica i campi anagrafici |
| POST | `/api/v1/animals/:id/archive` | Archivia senza cancellare lo storico |
| POST | `/api/v1/animals/:id/restore` | Ripristina un animale archiviato |
| DELETE | `/api/v1/animals/:id` | Elimina solo se non ha registri o relazioni collegate |

Parametri di lista: `page`, `pageSize` (massimo 100), `q`, `species`, `sex`, `morph`, `location`, `status` (`active`, `sold`, `transferred`, `deceased`, `archived`, `all`) e `sort` (`name`, `createdAt`, `updatedAt`). Senza `status`, la lista operativa mostra gli animali attivi. Gli identificativi devono essere univoci all'interno dell'account.

### Alimentazioni, pesi, mute e note

| Metodo | Endpoint | Funzione |
|---|---|---|
| GET / POST | `/api/v1/feeding-sessions` | Elenco paginato e creazione di alimentazioni singole o multiple |
| GET | `/api/v1/feeding-sessions/:id` | Dettaglio della sessione con voci |
| PATCH / DELETE | `/api/v1/feeding-entries/:id` | Corregge o rimuove una singola voce |
| GET / POST | `/api/v1/animals/:animalId/weights` | Cronologia e nuove pesate |
| PATCH / DELETE | `/api/v1/weights/:id` | Correzione o rimozione di una pesata |
| GET / POST | `/api/v1/animals/:animalId/sheds` | Cronologia e registrazione mute |
| PATCH / DELETE | `/api/v1/sheds/:id` | Correzione o rimozione di una muta |
| GET / POST | `/api/v1/animals/:animalId/notes` | Cronologia e creazione note |
| PATCH / DELETE | `/api/v1/animal-notes/:id` | Modifica o archivia una nota |
| GET | `/api/v1/animals/:animalId/history` | Cronologia unificata, ordinata per data |

Una sessione di alimentazione contiene da 1 a 500 animali e viene salvata insieme a tutte le voci nella stessa transazione PostgreSQL. Se anche un solo animale non appartiene all'account o non è attivo, l'intera operazione viene annullata. Esiti ammessi: `ate`, `refused`, `not_offered`, `unknown`; peso positivo in grammi per le pesate.

### Importazione CSV/XLSX guidata

L'importazione segue due passaggi: caricamento e anteprima privata, poi conferma esplicita. Il report viene conservato nel database e scade dopo un'ora; il file sorgente non viene pubblicato. I file sono limitati a 5 MB e 5.000 righe. Sono supportati CSV UTF-8 e XLSX, con scelta del foglio tramite il parametro sheet. Le intestazioni riconosciute vengono mappate automaticamente; quelle sconosciute sono riportate come non mappate. Le righe non valide restano nell'anteprima con numero di riga/colonna e non vengono importate.

Gli entity supportati sono animals, weights, sheds, notes, feedings, finance, inventory, reproductionCycles, reproductiveEvents, clutches, eggs, incubationLogs e offspringBatches. Per finance si può usare amountCents (intero) o amountEUR (valore decimale); per inventory, quantityOnHand crea anche il movimento di apertura. Le relazioni vengono risolte soltanto all'interno dell'account autenticato. Importare prima i cicli riproduttivi, poi eventi e covate, infine uova, registri d'incubazione e gruppi di nascita. Le righe riproduttive che referenziano cicli o covate devono usare UUID già esistenti.

Caricare i byte del file nel body della richiesta:

```bash
curl -X POST 'http://localhost:3000/api/v1/imports?entity=animals' \
  -H 'Origin: http://localhost:5173' \
  -H 'X-CSRF-Token: <token-csrf>' \
  -H 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' \
  --data-binary '@animali.xlsx' \
  -b cookies.txt
```

La risposta fornisce importId, righe valide, errori con riga/colonna e possibili omonimie per nome/specie. Dopo aver controllato l'anteprima, confermare:

```bash
curl -X POST 'http://localhost:3000/api/v1/imports/<importId>/confirm' \
  -H 'Origin: http://localhost:5173' \
  -H 'X-CSRF-Token: <token-csrf>' \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{}'
```

Se sono presenti possibili duplicati per nome e specie, la conferma di importazione animali richiede allowPossibleDuplicates=true. La conferma usa una transazione: le righe non valide sono escluse e riportate nel report finale. GET /api/v1/imports/:id mostra stato e report dell'importazione.

## Test d'integrazione PostgreSQL

La CI avvia PostgreSQL 18, applica la migrazione versionata e abilita `RUN_DB_INTEGRATION=true`. I test coprono CRUD, filtri/archiviazione, creazione multipla, import CSV/XLSX con conferma, alimentazione multipla atomica, registri di cura, input non validi e isolamento tra account.

## Operatività: attività, promemoria, Home «Oggi» e calendario

Queste API leggono e scrivono dati reali PostgreSQL e sono private per account. Le richieste mutative richiedono la protezione CSRF descritta nella sezione di autenticazione.

### Attività

| Metodo | Endpoint | Scopo |
|---|---|---|
| GET / POST | `/api/v1/tasks` | Lista paginata/filtrata e creazione di attività |
| GET | `/api/v1/tasks/:id` | Dettaglio dell’attività |
| PATCH | `/api/v1/tasks/:id` | Modifica titolo, descrizione, categoria, scadenza, animale o stato aperto/ignorato |
| POST | `/api/v1/tasks/:id/complete` | Completa un’attività senza cancellare lo storico |

Categorie ammesse: `feeding`, `weighing`, `shed_check`, `cleaning`, `reproduction`, `document`, `inventory`, `custom`. Gli stati sono `open`, `completed`, `dismissed`. Il completamento passa da una rotta dedicata per gestire correttamente le ricorrenze. I filtri lista includono `page`, `pageSize` (max 100), `status`, `category`, `animalId`, `from`, `to`. I filtri data accettano date locali `YYYY-MM-DD` o date/ore con offset.

### Promemoria ricorrenti

| Metodo | Endpoint | Scopo |
|---|---|---|
| GET / POST | `/api/v1/tasks/reminder-rules` | Lista e crea regole ricorrenti |
| PATCH | `/api/v1/tasks/reminder-rules/:id` | Aggiorna pianificazione, intervallo e attivazione |
| DELETE | `/api/v1/tasks/reminder-rules/:id` | Disattiva la regola e chiude le occorrenze aperte come ignorate |

Creare una regola attiva genera la sua prima attività. Quando questa viene completata, la transazione conserva la vecchia attività completata, aggiorna la regola e crea la successiva occorrenza; le scadenze ricorrenti mantengono l’ora locale dell’account anche attraverso i cambi di ora legale. L’intervallo ammesso è da 1 a 3.650 giorni.

### Home «Oggi» e calendario

- `GET /api/v1/home/today`: attività in scadenza oggi, scadute ancora aperte, completate oggi, promemoria imminenti, eventi recenti e collegamento rapido alla registrazione multipla delle alimentazioni. Il giorno è calcolato nel fuso orario dell’account.
- `GET /api/v1/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&view=month|week|list`: attività e record riproduttivi reali nel periodo selezionato, con date e fuso orario espliciti. Gli eventi di deposizione sono derivati anche dai record delle covate e vengono deduplicati quando esiste già un evento riproduttivo di deposizione nella stessa data/ciclo. Il calendario esclude per default le attività ignorate; `includeDismissed=true` permette di includerle.

La Home e il calendario sono per ora endpoint backend: non includono ancora le relative schermate React. Il worker backend controlla ogni minuto le attività aperte già scadute e crea notifiche deduplicate; l'invio push rispetta le preferenze e le fasce di quiet hours.

## Moduli di dominio: riproduzioni, inventario, documenti, finanze e notifiche

Le rotte private richiedono una sessione valida e il token CSRF per le richieste mutative.

### Riproduzioni

| Metodo | Endpoint | Funzione |
|---|---|---|
| GET / POST | `/api/v1/reproduction-cycles` | Lista paginata e creazione cicli |
| GET / PATCH | `/api/v1/reproduction-cycles/:id` | Scheda e modifica ciclo |
| GET / POST | `/api/v1/reproduction-cycles/:id/events` | Cronologia e inserimento eventi |
| POST | `/api/v1/clutches` | Registra una covata |
| GET / PATCH | `/api/v1/clutches/:id` | Scheda e modifica covata |
| GET / POST | `/api/v1/clutches/:id/eggs` | Consulta e inserisce uova |
| PATCH | `/api/v1/eggs/:id` | Modifica un uovo |
| GET / POST | `/api/v1/clutches/:id/incubation-logs` | Storico delle misurazioni d’incubazione |
| GET / POST | `/api/v1/offspring-batches` | Lista e creazione gruppi di nascita |
| POST | `/api/v1/offspring-batches/:id/animals` | Crea schede individuali collegate al gruppo |

I genitori devono appartenere all’account. Anche ciclo, covata, uova, incubazione e gruppi di nascita sono letti e modificati controllando la proprietà tramite le relazioni.

### Inventario

| Metodo | Endpoint | Funzione |
|---|---|---|
| GET / POST | `/api/v1/inventory/items` | Lista filtrata e creazione articoli |
| GET / PATCH | `/api/v1/inventory/items/:id` | Scheda e modifica articolo |
| POST | `/api/v1/inventory/items/:id/movements` | Registra entrata, uscita o rettifica |
| GET | `/api/v1/inventory/items/:id/movements` | Storico dei movimenti |
| POST | `/api/v1/inventory/items/:id/archive` | Archivia articolo |

Le quantità supportano tre decimali. Entrate e uscite sono variazioni positive; **per una rettifica, `quantity` è il nuovo saldo fisico contato**, non una variazione. Il movimento e il saldo sono salvati nella stessa transazione con lock della riga; non è possibile portare il saldo sotto zero. Gli articoli con saldo pari o inferiore alla soglia minima sono segnalati come scorta bassa.

### Documenti privati e condivisioni pubbliche

`POST /api/v1/documents` riceve i byte del file nel body e i metadati negli header `X-Document-Name`, `X-Document-Category` e almeno uno tra `X-Animal-Id` e `X-Cycle-Id`. Sono accettati PDF/JPEG/PNG/WebP reali fino a 10 MB; l’API confronta il MIME dichiarato con la firma del contenuto. I documenti si scaricano soltanto tramite `GET /api/v1/documents/:id/download` con autenticazione. Le cancellazioni sono soft-delete nel database e rimozione dell’oggetto privato.

In sviluppo e test i file vengono salvati in `PRIVATE_STORAGE_PATH`. In produzione il backend richiede storage S3 configurato tramite `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` e, se necessario, `S3_ENDPOINT`. Il Compose locale monta un volume persistente privato.

Per condividere una scheda: `POST /api/v1/animals/:id/public-share`, quindi modificare o revocare con `PATCH /api/v1/public-shares/:id`. La pagina pubblica è `GET /api/v1/public/animals/:slug`. Lo slug è casuale e non prevedibile; la pagina è disattivata di default e restituisce esclusivamente i campi presenti nella allowlist `name`, `species`, `morph`, `sex`, `birthDate`. Note, posizione, peso, alimentazioni, documenti e dati dell’account non sono pubblicati. L’API restituisce l’URL da usare anche per generare un QR; il codice QR grafico e l’interfaccia di gestione restano da implementare.

### Registro economico

| Metodo | Endpoint | Funzione |
|---|---|---|
| GET / POST | `/api/v1/finance/entries` | Lista filtrata e creazione di entrate/uscite |
| PATCH / DELETE | `/api/v1/finance/entries/:id` | Modifica o eliminazione voce |
| GET | `/api/v1/finance/summary` | Totali per tipo, categoria e saldo |

Gli importi sono espressi in centesimi interi, restituiti come stringhe per evitare perdita di precisione JSON. Il registro è gestionale, non un sistema fiscale o di fatturazione.

### Centro notifiche e preferenze

- `GET /api/v1/notifications`: lista paginata e conteggio non lette.
- `PATCH /api/v1/notifications/:id/read` e `POST /api/v1/notifications/read-all`: lettura singola o collettiva.
- `GET/PATCH /api/v1/notification-preferences`: canali, categorie e fascia di quiet hours.
- `POST /api/v1/push-subscriptions` e `DELETE /api/v1/push-subscriptions/:id`: registra o rimuove una sottoscrizione del browser.

Il mittente Web Push usa VAPID ES256 e cifratura RFC 8291 (ECDH P-256, HKDF-SHA256, AES-128-GCM). GET /api/v1/push/public-key espone la chiave pubblica; POST /api/v1/notifications/test-push invia una notifica di prova all'account autenticato. Gli endpoint provider in uscita sono allowlistati per limitare SSRF; le sottoscrizioni che rispondono 404/410 vengono rimosse. Configurare VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT prima di attivare push. Generare una coppia con pnpm vapid:generate e conservare la chiave privata solo nel secret manager/ambiente.

### Importazione ed esportazione

L’importazione CSV/XLSX usa anteprima privata e conferma esplicita. Sono supportati `entity=animals`, `entity=weights`, `entity=sheds`, `entity=notes` ed `entity=feedings`. Per i registri di cura il file deve includere `animalId` oppure `animalIdentifier`, oltre ai campi del registro. Le righe vengono validate con numero di riga/colonna e importate in una transazione; per le alimentazioni si raggruppano le voci con lo stesso istante in un’unica sessione.

`POST /api/v1/exports` produce un archivio ZIP di CSV con identificativi stabili, chiavi di relazione, morph genetici dichiarati, condivisioni e preferenze notifiche. Ogni CSV ha intestazioni anche quando non contiene righe. Il file `documents.csv` indicizza i documenti e i relativi percorsi; `includeDocuments: true` aggiunge anche i file privati, mentre il valore predefinito non include gli allegati. `GET /api/v1/exports/:id` mostra lo stato e `GET /api/v1/exports/:id/download` permette il download autenticato. Gli export scadono dopo 24 ore; il limite dell’archivio è 50 MB.

### Abbonamenti e Stripe

- `POST /api/v1/billing/checkout`: crea una sessione Stripe Checkout.
- `POST /api/v1/billing/portal`: crea una sessione Stripe Customer Portal.
- `GET /api/v1/billing/subscription`: restituisce stato locale e autorizzazione per la sottoscrizione.
- `POST /api/v1/webhooks/stripe`: verifica la firma sul body raw e deduplica l’ID evento.

Prima di attivare gli acquisti, configura `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` e `STRIPE_WEBHOOK_SECRET`, quindi registra l’URL webhook nella dashboard Stripe. La CI esegue test end-to-end deterministici con trasporto Stripe simulato e persistenza PostgreSQL: Checkout, Customer Portal, checkout.session.completed, aggiornamento, pagamento fallito/ripetuto e deduplicazione webhook. Non sono presenti credenziali per chiamare Stripe Test Mode reale, quindi prima del lancio va svolta una prova finale in staging con chiavi sk_test_... e webhook Stripe CLI/dashboard. Gli stati locali sono aggiornati da eventi firmati, non dal redirect del browser.


Esempio di importazione dei pesi:

```bash
curl -X POST 'http://localhost:3000/api/v1/imports?entity=weights' \
  -H 'Origin: http://localhost:5173' \
  -H 'X-CSRF-Token: <token-csrf>' \
  -H 'Content-Type: text/csv' \
  --data-binary '@pesi.csv' \
  -b cookies.txt
```

Il file può usare le colonne `animalIdentifier,measuredAt,weightG,notes`; il sistema risolve l’identificativo all’interno del solo account autenticato. Confermare con `POST /api/v1/imports/:importId/confirm`, dopo aver controllato l’anteprima e gli eventuali errori.


## Preparazione alla produzione, backup e ripristino

Con NODE_ENV=production l'applicazione rifiuta di avviarsi se mancano origini HTTPS, un CSRF_SECRET non predefinito, credenziali email, configurazione Stripe, chiavi VAPID o storage S3. Le credenziali devono essere fornite tramite secret manager o variabili dell'ambiente e non devono essere inserite nel repository. Verificare /healthz per liveness e /readyz per la connessione PostgreSQL.

- pnpm vapid:generate genera una coppia VAPID per sviluppo/staging. In produzione usare un secret manager e non rigenerare la coppia a ogni deploy.
- DATABASE_URL=... pnpm db:backup crea un dump PostgreSQL custom in ./backups, verifica l'archivio e scrive un checksum SHA-256. La copia va poi trasferita in storage cifrato e separato dal database.
- CONFIRM_RESTORE=YES DATABASE_URL=... pnpm db:restore ./backups/vivarqo-<timestamp>.dump verifica il checksum, se presente, e ripristina nel database di destinazione. Il comando non elimina gli oggetti esistenti: usare un database dedicato e vuoto e predisporre prima uno snapshot di rollback.

La CI copre build, tipi, migrazione e test su PostgreSQL. Prima del lancio reale servono ancora un test di restore su staging, la verifica della configurazione S3 reale, il test Stripe Test Mode con credenziali del proprietario e una prova da browser reale per i permessi push. Le API backend sono implementate ma le schermate React/PWA non fanno parte di questo incremento.
