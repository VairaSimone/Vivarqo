# Frontend Vivarqo

Il frontend è scritto in **TypeScript** con React 19, TSX e Vite. Le sorgenti applicative sono in `src/**/*.ts` e `src/**/*.tsx`; Vite esegue il bundling e TypeScript controlla i tipi prima della build.

## Comandi

Dalla root del repository:

- `pnpm dev:frontend` avvia Vite.
- `pnpm --filter @vivarqo/frontend typecheck` esegue il controllo TypeScript dell'app.
- `pnpm build:frontend` compila il service worker TypeScript, esegue il type-check e crea la build di produzione.
- `cd frontend/e2e && npm install && npm run typecheck && npm test` verifica i test browser Playwright (anche questi scritti in TypeScript).

## Service worker

La sorgente è `src/sw.ts`; `tsconfig.sw.json` la compila in `public/sw.js`, il percorso statico registrato dalla PWA. Il file JavaScript pubblicato è un artefatto generato, non una sorgente da modificare a mano.

## Controlli TypeScript

La configurazione applicativa abilita strict mode, con controlli gradualmente allentati per i dati dinamici legacy dell'API (`noImplicitAny: false` e `strictNullChecks: false`). I moduli condivisi (API client, component props e dialog) dichiarano tipi espliciti. La migrazione non cambia routing, componenti UI, CSS o comportamento offline.
