# Frontend Vivarqo

Prima base React + Vite per l'interfaccia web.

## Avvio

Dalla root del monorepo:

```bash
pnpm install
pnpm dev:frontend
```

Apri `http://localhost:5173`. Il server di sviluppo inoltra `/api/*`, `/healthz` e `/readyz` all'API locale su `http://127.0.0.1:3000`. Avvia prima il backend e PostgreSQL quando vuoi verificare il collegamento API.

La dashboard contiene ancora dati dimostrativi. Le richieste future dovranno usare il client in `src/api/api.js`, che include i cookie di sessione e mantiene il token CSRF in memoria, non in `localStorage`.
