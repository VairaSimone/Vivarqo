# Frontend Vivarqo

React + Vite, mobile-first. Avvia dalla root con `pnpm dev:frontend`; l'API deve essere attiva su `http://127.0.0.1:3000` (o imposta `VIVARQO_API_TARGET`).

## Guide incluse
- **Guide e tutorial → Tutorial per usare il sito**: accesso, registri, attività e portabilità.
- **Guide e tutorial → Tutorial per installare e usare la PWA**: installazione Android/desktop/iOS, notifiche e limiti offline.

## PWA e privacy
La manifest e il service worker sono inclusi. Il service worker non intercetta né mette in cache `/api/v1/*`, health/readiness o risposte personali. I dati e tutte le scritture richiedono rete e sessione valida; non viene simulata una modalità offline con salvataggi locali. Le notifiche push richiedono consenso esplicito dalla schermata Notifiche.

## Stato delle schermate
La UI usa API autenticate per login, dashboard, animali, alimentazioni, attività, inventario, riproduzioni, documenti, genetica, registro economico, notifiche, import/export, billing e impostazioni. Alcune azioni avanzate (es. modifica di singoli registri, gestione completa di uova/covate e upload documenti) richiedono ulteriori schermate dedicate: le liste possono mostrare dati API senza esporre ancora ogni azione di modifica.
