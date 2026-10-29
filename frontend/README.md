# Frontend Vivarqo

Frontend React + Vite con interfaccia mobile-first, area desktop responsive e PWA installabile. La UI usa le API di Vivarqo; non usa record fittizi per sostituire le risposte del backend.

## Avvio locale

Dalla root del repository:

- `pnpm install`
- `pnpm dev:api` in un terminale
- `pnpm dev:frontend` in un secondo terminale
- Apri `http://localhost:5173`

Il backend richiede PostgreSQL e la configurazione `.env` descritta nella documentazione backend. Il proxy Vite punta per default a `http://127.0.0.1:3000`; configura `VIVARQO_API_TARGET` se l'API è su un altro indirizzo.

## Moduli coperti

- Account: registrazione, accesso, recupero password, sessione, impostazioni.
- Allevamento: schede animali, alimentazioni, peso, mute, note, genetica e storico.
- Organizzazione: attività, promemoria, calendario, inventario e movimenti di magazzino, registro economico.
- Riproduzione: cicli, genitori, eventi, covate, uova, registri d'incubazione, lotti di piccoli e creazione di schede animali dai lotti.
- Documenti e QR: upload/download privati, modifica metadati, eliminazione documenti, link pubblici configurabili e revocabili, QR SVG generato sul dispositivo.
- Notifiche: lettura in-app, preferenze, categorie, orari di silenzio, iscrizioni push per browser, rimozione dispositivi e invio di prova.
- Dati e piano: import/export e schermata abbonamento.
- Guide: tutorial separati per l'uso del sito e per installazione/uso della PWA.

Le operazioni di modifica/eliminazione rispettano i contratti disponibili nel backend; operazioni bloccate da record collegati devono mostrare l'errore del server, non simulare l'eliminazione.

## PWA, privacy e uso offline

Il manifest e il service worker sono inclusi. Il service worker mette in cache solo risorse statiche pubbliche e la shell di navigazione; non intercetta né memorizza risposte `/api/v1/*`, documenti privati o dati dell'account. I profili pubblici sono visualizzati dalla rotta frontend `/public/animals/:slug`; la pagina legge i soli campi esplicitamente condivisi tramite l'API `/api/v1/public/animals/:slug`.

Alcune modifiche JSON compatibili possono essere accodate in IndexedDB e inviate automaticamente quando la connessione torna disponibile e Vivarqo è aperto. La coda ha un limite di sicurezza di 250 modifiche per account e 64 KiB per singolo payload. Upload, allegati, import/export, pagamenti, condivisioni pubbliche, registrazioni push e preferenze notifiche richiedono la connessione. Non è implementata la sincronizzazione in background quando l'app è chiusa.

Se una richiesta ha un esito di rete incerto, Vivarqo non la ripete automaticamente: mostra una verifica manuale per ridurre il rischio di duplicati. La coda è locale e non cifrata dall'app; usa questa funzione solo su dispositivi personali protetti, e non cancellare la coda prima di aver verificato o sincronizzato le modifiche.

Le notifiche push richiedono HTTPS, consenso esplicito del browser, service worker attivo e chiavi VAPID valide lato server. La disponibilità della consegna dipende anche dal browser e dal sistema operativo.

## Verifiche automatiche

La CI esegue i test/type-check/build del backend e una build separata del frontend. La build non sostituisce un test manuale dei flussi, soprattutto per notifiche push, PWA installata e servizi esterni.
