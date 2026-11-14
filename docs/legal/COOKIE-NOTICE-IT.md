# Informativa cookie e strumenti analoghi — SnakeBee (bozza operativa)

> **BOZZA — NON PUBBLICARE PRIMA DELL'AUDIT DELLA BUILD E DEL DOMINIO DI PRODUZIONE.** Il repository non prova quali strumenti vengano effettivamente caricati in produzione.

**Titolare:** [DATI] — **Contatto:** [EMAIL PRIVACY] — **Versione documento:** 0.3 / 14 novembre 2026.

## Ambito e rilievi

L'informativa deve coprire cookie, local/session storage, SDK, pixel, tag, identificatori, richieste di rete e strumenti inseriti da CDN, hosting, monitoraggio o terze parti. La classificazione dipende da funzione e finalità effettive, non dal nome o dalla durata.

Nel codice sono presenti funzioni di autenticazione e CSRF che possono usare cookie tecnici. Non è stato individuato un SDK esplicito analytics/advertising nel repository esaminato; ciò non esclude strumenti aggiunti in produzione o dall'infrastruttura. La build e il dominio di produzione devono essere controllati con un browser pulito, inclusi cookie, storage e richieste di rete.

## Comportamento attualmente implementato

La UI mostra un avviso informativo al primo accesso e consente di riaprire le preferenze dal footer o dal pulsante persistente. Poiché il registro dei servizi facoltativi è attualmente vuoto, l'avviso dichiara che non risultano configurati analytics/marketing e propone soltanto la presa visione; non raccoglie un consenso generico e non simula l'esistenza di tracker. La scelta viene memorizzata nel local storage esclusivamente per ricordare la presa visione.

Il registro OPTIONAL_COOKIE_SERVICES in packages/frontend/src/lib/cookieConsent.ts è intenzionalmente vuoto. Non aggiungere servizi senza prima documentare fornitore, finalità, durata, dominio, categoria, base giuridica e trasferimenti. Quando un servizio facoltativo che richiede consenso viene introdotto:
1. inserirlo nel registro con identificatore stabile, nome, finalità specifica e categoria;
2. aggiornare questa informativa con fornitore e tecnologie effettive;
3. incrementare COOKIE_POLICY_VERSION per invalidare le scelte precedenti;
4. integrare lo script esclusivamente tramite un controllo preventivo di hasOptionalCookieConsent(serviceId), senza precaricare tracker o inviare richieste prima del consenso;
5. mostrare accettazione, rifiuto e personalizzazione con pari evidenza, mantenere i servizi disattivati per default e consentire revoca/modifica sempre accessibile;
6. verificare che la revoca impedisca ulteriori caricamenti e, ove tecnicamente possibile, rimuova gli identificatori già impostati.

## Strumenti necessari

Inventariare nome, dominio, durata, finalità, parte prima/terza e motivo di necessità per sessione, CSRF, preferenze e service worker/storage. Non classificare automaticamente come tecnico uno strumento solo perché proprietario.

## Strumenti non necessari

Se analytics, advertising, profilazione o altri strumenti richiedono consenso, bloccarli prima della scelta; fornire rifiuto facile quanto accettazione, scelta granulare ove pertinente e possibilità di modifica/revoca. Non attivare tracker prima del consenso valido. Se sono presenti solo strumenti tecnici, non mostrare pulsanti di consenso privi di oggetto: fornire l'informativa appropriata.

## Inventario da completare

| Nome/fornitore | Dominio | Finalità/categoria | Durata | Parte | Base/consenso |
|---|---|---|---|---|---|
| Cookie sessione | [..] | Autenticazione | [..] | [..] | Necessità tecnica da verificare |
| Cookie/token CSRF | [..] | Sicurezza | [..] | [..] | Necessità tecnica da verificare |
| Analytics/marketing | [solo se presenti] | [..] | [..] | [..] | [consenso/base] |

Prima del rilascio: browser pulito, prima/dopo login, desktop/mobile, network waterfall, cookie e storage, script CDN/tag manager, error tracking, widget, richieste server-side. Registrare evidenze e data audit. Se cambiano gli strumenti, aggiornare inventario, versione della policy e interfaccia di consenso.

Riferimenti: art. 122 Codice Privacy, direttiva ePrivacy e Linee guida cookie del Garante 10 giugno 2021.
