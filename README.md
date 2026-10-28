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
- Sono disponibili le API di account e autenticazione descritte sotto. Gli altri moduli di dominio saranno aggiunti progressivamente sotto `/api/v1`.

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

