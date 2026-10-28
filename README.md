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
pnpm db:migrate:deploy
pnpm dev:api
```

Questa modalità avvia l'API sul computer e PostgreSQL in Docker. Dopo aver applicato la migrazione, in alternativa puoi eseguire anche l'API in container con:

```bash
docker compose -f infra/docker/compose.yaml up -d --build api
```

La configurazione Compose dell'API legge le variabili da `.env` ma sovrascrive `DATABASE_URL` per usare il servizio `postgres` della rete Docker. Non applica automaticamente le migrazioni.

La migrazione iniziale riproduce senza modifiche lo SQL consegnato ed è destinata a un database **VUOTO**. Non applicarla a un database con dati o tabelle preesistenti. `migrate deploy` applica solo le migrazioni versionate; non usare `prisma db push` per inizializzare o aggiornare questo schema.

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

### Importazione CSV/XLSX degli animali

L'importazione segue due passaggi: caricamento e anteprima privata, poi conferma esplicita. Il file è conservato come report di anteprima nel database e scade dopo un'ora; non viene scritto in un bucket pubblico. I file sono limitati a 5 MB e 5.000 righe. Sono supportati CSV UTF-8 e XLSX, con scelta del foglio mediante il parametro `sheet`. Le intestazioni possono essere in italiano o in inglese; le colonne riconosciute vengono mappate automaticamente, le altre vengono riportate come non mappate.

Caricare i byte del file nel body della richiesta:

```bash
curl -X POST 'http://localhost:3000/api/v1/imports?entity=animals' \
  -H 'Origin: http://localhost:5173' \
  -H 'X-CSRF-Token: <token-csrf>' \
  -H 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' \
  --data-binary '@animali.xlsx' \
  -b cookies.txt
```

La risposta fornisce `importId`, righe valide, errori con riga/colonna e possibili omonimie per nome e specie. Dopo aver controllato l'anteprima:

```bash
curl -X POST 'http://localhost:3000/api/v1/imports/<importId>/confirm' \
  -H 'Origin: http://localhost:5173' \
  -H 'X-CSRF-Token: <token-csrf>' \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{}'
```

Se sono presenti possibili duplicati per nome e specie, la conferma richiede `{"allowPossibleDuplicates":true}`. La conferma usa una transazione: le righe non valide sono escluse e riportate nel report finale. `GET /api/v1/imports/:id` mostra stato e report dell'importazione.

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

La Home e il calendario sono per ora endpoint backend: non includono ancora le relative schermate React. Le notifiche push web non fanno parte di questo incremento.

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

Le sottoscrizioni browser sono persistite, ma l’invio push tramite VAPID non è ancora attivo; non viene quindi promessa la consegna di notifiche push.

### Importazione ed esportazione

L’importazione CSV/XLSX con anteprima e conferma implementata in precedenza supporta attualmente le anagrafiche animali. I formati d’importazione di alimentazioni, pesi, mute, note e altri registri non sono ancora stati aggiunti.

`POST /api/v1/exports` produce un archivio ZIP di CSV con identificativi stabili e chiavi di relazione; `includeDocuments: true` include anche i file privati associati. `GET /api/v1/exports/:id` mostra lo stato e `GET /api/v1/exports/:id/download` permette il download autenticato. Gli export scadono dopo 24 ore; il limite dell’archivio è 50 MB.

### Abbonamenti e Stripe

- `POST /api/v1/billing/checkout`: crea una sessione Stripe Checkout.
- `POST /api/v1/billing/portal`: crea una sessione Stripe Customer Portal.
- `GET /api/v1/billing/subscription`: restituisce stato locale e autorizzazione per la sottoscrizione.
- `POST /api/v1/webhooks/stripe`: verifica la firma sul body raw e deduplica l’ID evento.

Prima di attivare gli acquisti, configura `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` e `STRIPE_WEBHOOK_SECRET`, quindi registra l’URL webhook nella dashboard Stripe. La CI non usa credenziali Stripe e non esegue pagamenti reali; l’integrazione va verificata con Stripe Test Mode nell’ambiente di staging. Gli stati locali sono aggiornati da eventi firmati, non dal redirect del browser.

