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
