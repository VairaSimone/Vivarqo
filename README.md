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
- Le route applicative previste dalla specifica non sono ancora implementate in questo incremento. Le route di dominio saranno aggiunte sotto `/api/v1`.

## Configurazione
Copia `.env.example` in `.env`. Le chiavi provider sono vuote o segnaposto dimostrativi: non inserire segreti reali nel repository. `DATABASE_URL` deve essere una URL PostgreSQL valida; `APP_ORIGIN` è l'origine frontend ammessa da CORS.

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
Implementato: configurazione tipizzata, logger strutturato, header di sicurezza, CORS con origine configurata, rate limit generale API, request-id, gestione errori JSON coerente, health/readiness, Prisma + adapter PostgreSQL, migrazione SQL originale, Compose locale e test HTTP con dipendenze iniettate.

Non ancora implementato: registrazione/login/sessioni/CSRF, email, risorse di dominio, autorizzazioni tenant applicative, Stripe, storage S3, notifiche/job, OpenAPI completa e frontend React. La presenza delle tabelle non implica che tali funzionalità siano disponibili.

Le discrepanze note sono annotate in [docs/architecture-decisions.md](docs/architecture-decisions.md). La specifica ricevuta è conservata in [docs/specification.md](docs/specification.md).
