# Informativa cookie e strumenti analoghi — SnakeBee (bozza operativa)

> **BOZZA — NON PUBBLICARE PRIMA DELL'AUDIT DELLA BUILD E DEL DOMINIO DI PRODUZIONE.** Il repository non prova quali strumenti vengano effettivamente caricati in produzione.

**Titolare:** [DATI] — **Contatto:** [EMAIL PRIVACY] — **Versione:** 0.2 / 14 novembre 2026.

## Ambito e rilievi

L'informativa deve coprire cookie, local/session storage, SDK, pixel, tag, identificatori, richieste di rete e strumenti inseriti da CDN, hosting, monitoraggio o terze parti. La classificazione dipende da funzione e finalità effettive, non dal nome o dalla durata.

Nel codice sono presenti funzioni di autenticazione e CSRF che possono usare cookie tecnici. Non è stato individuato un SDK esplicito analytics/advertising nel repository esaminato; ciò non esclude strumenti aggiunti in produzione o dall'infrastruttura.

## Strumenti necessari

Inventariare nome, dominio, durata, finalità, parte prima/terza e motivo di necessità per sessione, CSRF, preferenze e service worker/storage. Non classificare automaticamente come tecnico uno strumento solo perché proprietario.

## Strumenti non necessari

Se analytics, advertising, profilazione o altri strumenti richiedono consenso, bloccarli prima della scelta; fornire rifiuto facile quanto accettazione, scelta granulare ove pertinente e possibilità di modifica/revoca. Non attivare tracker prima del consenso valido. Se sono presenti solo strumenti tecnici, non mostrare un banner ingannevole: fornire l'informativa appropriata.

## Inventario da completare

| Nome/fornitore | Dominio | Finalità/categoria | Durata | Parte | Base/consenso |
|---|---|---|---|---|---|
| Cookie sessione | [..] | Autenticazione | [..] | [..] | Necessità tecnica da verificare |
| Cookie/token CSRF | [..] | Sicurezza | [..] | [..] | Necessità tecnica da verificare |
| Analytics/marketing | [se presenti] | [..] | [..] | [..] | [consenso/base] |

Prima del rilascio: browser pulito, prima/dopo login, desktop/mobile, network waterfall, cookie e storage, script CDN/tag manager, error tracking, widget, richieste server-side. Registrare evidenze e data audit. Se cambiano gli strumenti, aggiornare inventario e interfaccia di consenso.

Riferimenti: art. 122 Codice Privacy, direttiva ePrivacy e Linee guida cookie del Garante 10 giugno 2021.
