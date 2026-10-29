# Checklist legale pre-lancio

Questa lista richiede prove e decisioni dell'operatore; non deve essere chiusa solo perché esistono i modelli.

- [ ] Titolare e contatti legali verificati; deleghe/ruoli e eventuale DPO valutati.
- [ ] Registro trattamenti e mappa dati per account, animali, documenti, finanze, condivisioni, log, email, push, fatturazione, supporto e backup.
- [ ] Finalità e basi giuridiche validate per ciascuna categoria; minimizzazione e default privacy testati.
- [ ] Informativa privacy approvata; diritti esercitabili e processo di risposta testato.
- [ ] Retention per ciascuna categoria approvata, inclusi log, dati cancellati, backup, ticket di supporto e obblighi fiscali/contrattuali.
- [ ] DPA/sub-responsabili, regioni e possibili trasferimenti controllati per database, hosting, storage, email, Stripe, Sentry e backup.
- [ ] Sicurezza art. 32 documentata: gestione segreti, TLS, cifratura dati/backup, access control, patching, logging, incident response e restore drill.
- [ ] Cookie/storage audit su una sessione pulita; banner/pannello, rifiuto, consenso e revoca testati dove necessari.
- [ ] Verificare l'uso di tracking pixel/open tracking nelle email (anche tramite il provider); il Garante ha pubblicato linee guida specifiche il 17 aprile 2026, pubblicate in G.U. il 29 aprile 2026. Disabilitare il tracking non necessario, oppure fornire informativa e valutare/ottenere il consenso preventivo quando richiesto; registrare anche la modalità di revoca. [Provvedimento Garante n. 284/2026](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/10241943).
- [ ] Termini di servizio e prezzi verificati rispetto ai piani realmente attivi, inclusi trial, rinnovo, recesso, cancellazione, rimborsi e fatturazione.
- [ ] Applicabilità DSA e altri obblighi per contenuti pubblici e condivisioni valutata; segnalazione e presa in carico implementate quando richiesto.
- [ ] Stripe Test Mode completato e prove conservate; passaggio a Live controllato separatamente.
- [ ] Backup automatici pianificati, copia offsite cifrata e restore drill eseguiti con RPO/RTO registrati.
- [ ] Sentry testato in staging con redazione dei dati sensibili verificata.
- [ ] Versioni pubblicate con numero/data, link accessibili dalla UI e processo di revisione periodica.

Riferimenti principali: GDPR (Reg. UE 2016/679), Codice Privacy italiano (d.lgs. 196/2003), linee guida cookie del Garante del 10 giugno 2021, DSA (Reg. UE 2022/2065) e disciplina dei contratti per servizi digitali da valutare secondo il mercato target. L'applicabilità concreta va determinata con un professionista.