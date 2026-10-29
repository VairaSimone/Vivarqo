# Frontend Vivarqo

React + Vite, mobile-first. Avvia dalla root con `pnpm dev:frontend`; l'API deve essere attiva su `http://127.0.0.1:3000` (o imposta `VIVARQO_API_TARGET`).

## Guide incluse
- **Guide e tutorial → Tutorial per usare il sito**: accesso, registri, attività e portabilità.
- **Guide e tutorial → Tutorial per installare e usare la PWA**: installazione Android/desktop/iOS, notifiche e limiti offline.

## PWA e privacy
La manifest e il service worker sono inclusi. Il service worker non intercetta né mette in cache `/api/v1/*`, health/readiness o risposte personali. I dati e tutte le scritture richiedono rete e sessione valida; non viene simulata una modalità offline con salvataggi locali. Le notifiche push richiedono consenso esplicito dalla schermata Notifiche.

## Stato delle schermate
La UI usa API autenticate per login, dashboard, animali, alimentazioni, attività, inventario, riproduzioni, documenti, genetica, registro economico, notifiche, import/export, billing e impostazioni. Alcune azioni avanzate (es. modifica di singoli registri, gestione completa di uova/covate e upload documenti) richiedono ulteriori schermate dedicate: le liste possono mostrare dati API senza esporre ancora ogni azione di modifica.


## Funzioni avanzate e uso offline

- **Riproduzioni**: cicli, genitori, eventi, covate, uova singole, controlli d'incubazione e lotti di piccoli; i lotti possono creare schede animali. Le eliminazioni rispettano i legami fra record e restituiscono un errore esplicito quando è necessario rimuovere prima i record collegati.
- **Registri**: peso, mute, note, alimentazioni e tratti genetici dispongono di creazione, modifica ed eliminazione; anche schede animali, attività, articoli d'inventario e voci economiche espongono le operazioni disponibili per il relativo contratto API. Le quantità di magazzino si modificano tramite movimenti, non alterando direttamente la giacenza.
- **Documenti e QR**: PDF e immagini vengono caricati e scaricati solo online; la pagina consente di modificare i metadati, eliminare i file, scegliere i campi pubblici e revocare la condivisione. Il QR SVG è generato nel browser senza inviare il link a servizi esterni. I profili pubblici sono aperti solo attraverso il percorso /public/animals/:slug.
- **Notifiche**: la pagina gestisce notifiche in-app, preferenze, orari di silenzio, sottoscrizioni push per browser, revoca dei dispositivi e invio di prova. Le categorie configurate corrispondono a quelle attualmente generate dal server: scadenze delle attività e notifiche di sistema. Le notifiche push richiedono HTTPS, permesso del browser e chiavi VAPID valide sul server.
- **PWA/offline**: il service worker mette in cache solo la shell e risorse statiche; non intercetta né memorizza risposte /api, documenti privati o dati autenticati. Alcune modifiche JSON vengono accodate in IndexedDB (massimo 250 elementi per account, payload massimo 64 KiB ciascuno) e inviate automaticamente quando la connessione torna disponibile e Vivarqo è aperto. Non vengono accodati upload di file, pagamenti, condivisioni, registrazione push o preferenze. In caso di esito incerto la coda richiede una verifica manuale per evitare duplicati. I dati della coda locale non sono cifrati dall'app: non usare questa funzione su dispositivi condivisi non protetti.
