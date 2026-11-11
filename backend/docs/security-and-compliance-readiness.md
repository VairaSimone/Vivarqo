# Sicurezza e conformità: stato, controlli e attività prima del lancio

**Revisione tecnica:** 11 novembre 2026  
**Ambito verificato:** branch `main`, inclusi backend/API, database/migrazioni, frontend React/PWA, test E2E e configurazioni Docker di sviluppo e produzione. Le configurazioni versionate non dimostrano da sole che provider, certificati TLS o backup off-site siano stati attivati su un ambiente reale.  
**Importante:** questa è una checklist tecnica, non una certificazione di conformità né un parere legale. La conformità dipende anche da chi gestisce il servizio, dalle finalità effettive, dai fornitori, dai paesi serviti, dai contratti e dai processi organizzativi.

## 1. Modifiche tecniche applicate in questo branch

- **Sessioni:** cookie HttpOnly, SameSite=Lax, Secure in produzione, token di sessione casuali conservati nel database come hash, scadenza idle e limite assoluto.
- **CSRF/CORS:** le richieste browser mutative richiedono token CSRF; CORS usa un'origine applicativa specifica.
- **Autenticazione:** password hash con Argon2id, token monouso per verifica/reset e risposte generiche per i flussi email.
- **Rate limit auth:** i limiti di registrazione/login/reset/verifica usano PostgreSQL, sono condivisi fra repliche e memorizzano HMAC degli identificativi del client anziché IP grezzi. Le righe scadute vengono ripulite dal worker.
- **Log:** i log HTTP non registrano più il percorso grezzo della richiesta, che può contenere uno slug di condivisione pubblica utilizzabile come link-capability. I log di startup non emettono il messaggio grezzo dell'eccezione.
- **Cache:** le risposte API e le pagine pubbliche di condivisione hanno `Cache-Control: no-store`.
- **Proxy:** `TRUST_PROXY_HOPS` è esplicito e predefinito a zero. Va aumentato solo se il backend è raggiungibile esclusivamente attraverso una catena di proxy fidati e nota.
- **Retenzione tecnica:** vengono eliminati token scaduti/consumati, sessioni scadute, anteprime import scadute, contatori di rate limit scaduti ed export scaduti (incluso il file privato; in caso di errore l'eliminazione viene ritentata).
- **Portabilità:** l'archivio dati include anche i dati di profilo essenziali e i dati dell'abbonamento, senza password hash o token di autenticazione.

## 2. GDPR e Codice Privacy italiano: cosa il codice copre e cosa no

Riferimenti di base: [Regolamento (UE) 2016/679 — GDPR](https://eur-lex.europa.eu/legal-content/IT-EN/TXT/?uri=CELEX:32016R0679) e [D.lgs. 196/2003, Codice in materia di protezione dei dati personali, testo vigente](https://www.normattiva.it/eli/id/2003/07/29/003G0218/CONSOLIDATED/20260421).

| Area | Stato tecnico attuale | Attività necessaria prima del lancio |
|---|---|---|
| Privacy by design/minimizzazione | Query separate per account; campi pubblici in allowlist; log redatti; artefatti temporanei con scadenza. | Verificare il ciclo di vita di tutti i dati, inclusi log, backup, email, fornitori e account disattivati. |
| Informativa artt. 13–14 | È presente una bozza in `docs/legal/PRIVACY-NOTICE-IT.md`, ancora incompleta e con segnaposto. | Identificare il titolare legale, contatti, finalità, basi giuridiche, categorie di dati, destinatari/responsabili, trasferimenti, retention, diritti e reclamo al Garante. Non inventare questi dati nel codice. |
| Diritti dell'interessato | È disponibile l'export tecnico, gli endpoint di modifica e `DELETE /api/v1/account` per la cancellazione self-service con verifica della password e conferma esplicita. | Verificare in staging il ciclo completo di cancellazione, inclusi oggetti S3, abbonamento Stripe, copie residue e retention dei backup; documentare i canali per accesso, rettifica, limitazione, opposizione e portabilità quando applicabili. Definire e applicare le eccezioni di conservazione legale. |
| Responsabili del trattamento art. 28 | Email transazionali, storage e pagamenti sono integrazioni esterne configurabili. | Verificare e archiviare DPA/accordi con ogni provider, elenco sub-responsabili, regioni effettive e istruzioni di trattamento. |
| Trasferimenti internazionali | Il codice non dimostra dove il provider o ogni sub-responsabile tratti tutti i dati. | Verificare regione, accessi di supporto, sub-responsabili e meccanismo GDPR per eventuali trasferimenti extra-SEE; predisporre valutazioni supplementari se necessarie. |
| Sicurezza art. 32 | Autenticazione server-side, hash dei token, CSRF, limiti dimensione, storage privato, logging minimizzato e retention di dati transitori. | Configurare TLS, cifratura a riposo/KMS e backup, least privilege, segreti gestiti e rotati, patching, scansioni dipendenze, test di ripristino e controllo accessi ai log. |
| Violazioni artt. 33–34 | Non esiste un flusso organizzativo per l'incident response nel codice. | Definire procedura e registro incidenti, ruoli e contatti. Il titolare valuta il rischio e, ove richiesto, notifica il Garante senza ingiustificato ritardo e possibilmente entro 72 ore; un rischio elevato può richiedere anche comunicazione agli interessati. |
| DPIA art. 35 | Non è possibile stabilire dal solo repository se sia obbligatoria. | Effettuare e documentare uno screening DPIA sui trattamenti effettivi; svolgerla prima del trattamento se ricorrono i criteri previsti. |
| Conservazione | Import/export e token hanno scadenze tecniche ora applicate dal worker. | Approvare un retention schedule per account, sessioni, notifiche, documenti cancellati, audit, supporto, dati amministrativi e backup, quindi allineare policy e processi reali. |

Il Garante spiega che le violazioni vanno documentate e che la notifica entro 72 ore dipende dalla valutazione del rischio: [Data breach — Garante Privacy](https://www.garanteprivacy.it/data-breach).

## 3. Cookie, ePrivacy e consenso

Il frontend React/PWA è presente in `packages/frontend`. Il codice non dimostra quali cookie, SDK o tracker siano effettivamente caricati dal dominio pubblico o aggiunti dall'infrastruttura: verificare build distribuita, richieste di rete e storage in browser pulito.

Prima del rilascio:
- documentare i cookie strettamente necessari (sessione e CSRF) e le loro finalità nella policy pertinente;
- non attivare analytics non esenti, advertising, fingerprinting o altri tracker non necessari prima di aver raccolto un consenso valido, quando richiesto;
- implementare nel nuovo frontend un pannello che permetta di accettare/rifiutare i tracker non necessari senza dark pattern, modificare le preferenze e revocare il consenso;
- conservare una prova delle scelte quando il consenso è la base giuridica, e impedire il caricamento dei tracker prima della scelta.

Riferimento ufficiale: [Linee guida del Garante su cookie e altri strumenti di tracciamento, 10 giugno 2021](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9677876) e art. 122 del Codice Privacy.

## 4. Condivisioni pubbliche e Digital Services Act

Le schede animali condivise sono contenuti forniti dagli utenti e accessibili senza autenticazione tramite URL. È quindi necessario valutare con consulenza legale se e in quale misura il servizio ricada nelle definizioni e negli obblighi del [Regolamento (UE) 2022/2065 — Digital Services Act](https://eur-lex.europa.eu/eli/reg/2022/2065).

Prima di rendere pubbliche le condivisioni:
- stabilire un contatto legale/DSA e indicarlo secondo gli obblighi applicabili;
- predisporre un meccanismo elettronico, accessibile e semplice per segnalare contenuti ritenuti illegali, con identificazione della pagina, motivazione e recapito quando necessario;
- definire il flusso interno di presa in carico, valutazione, azione, comunicazione della decisione e registrazione delle motivazioni dove richiesto;
- pubblicare termini chiari su contenuti, condivisioni, revoca, segnalazioni, sospensione e contestazione;
- evitare di considerare `noindex` o uno slug casuale una misura di privacy: un link condiviso può essere inoltrato o copiato.

L'applicabilità di obblighi specifici e possibili esenzioni dipende dal ruolo concreto del servizio, dalla dimensione dell'impresa e dal modello operativo: non è corretto presumere automaticamente né esenzione né applicazione integrale.

## 5. Abbonamenti e tutela del consumatore in Italia/UE

L'API integra Stripe Checkout e Customer Portal e il frontend contiene la pagina di gestione dell'abbonamento. Restano da completare e pubblicare le condizioni contrattuali e le informazioni precontrattuali, e da verificare i flussi reali di checkout, rinnovo, disdetta e recesso. Se il servizio è offerto anche a consumatori, serve una revisione rispetto al Codice del Consumo e alle norme sui contratti di servizi digitali, inclusa la [Direttiva (UE) 2019/770](https://eur-lex.europa.eu/eli/dir/2019/770/oj?locale=it) e il recepimento nazionale.

Prima del lancio commerciale verificare: identità del professionista, prezzo totale e imposte, frequenza di addebito, rinnovo e cessazione, funzionalità del piano, prova gratuita se presente, modalità di reclamo, diritto di recesso ed eventuali eccezioni/consensi specifici, aggiornamenti e rimedi per difetti di conformità. Le schermate Stripe da sole non sostituiscono le informazioni precontrattuali e i termini legali.

## 6. Altri mercati

Non esiste una singola legge mondiale applicabile in modo identico a tutti gli utenti. Se si accettano utenti o pagamenti in altri paesi, effettuare una matrice giurisdizionale basata su sede del titolare, mercati target, utenti, volumi e categorie di dati. Valutare caso per caso, fra gli altri, UK GDPR/UK Data Protection Act, leggi statunitensi statali sulla privacy (ad esempio CCPA/CPRA quando applicabili), e regole locali di e-commerce, marketing, conservazione e trasferimento dati. NIS2 e CRA non vanno dichiarati automaticamente applicabili o non applicabili senza analizzare soggetto, settore, prodotto e dimensione.

## 7. Operatività e blocchi prima della produzione

- [ ] Definire identità legale del titolare e contatti per privacy, supporto e segnalazioni.
- [ ] Pubblicare Privacy Notice, Cookie/Tracking Notice ove necessaria, Termini e condizioni e informazioni precontrattuali.
- [ ] Definire basi giuridiche e retention per ogni trattamento; conservare DPA e mappa dei fornitori.
- [ ] Verificare cancellazione account, cancellazione effettiva di storage e routine dei backup; mantenere solo i dati che devono essere conservati per obbligo legale documentato.
- [ ] Definire e provare il piano di risposta ai data breach con responsabilità, escalation e tempistiche.
- [ ] Configurare e verificare TLS, storage/database/backup cifrati, regione UE ove richiesta, secret manager e accessi minimi.
- [x] Il limite globale `300/15 minuti` su `/api/v1` usa `persistentRateLimit(300, "api-global")` e `PostgresRateLimitStore`: i contatori HMAC sono persistenti e condivisi tra repliche. Il test `rate-limit.integration.test.ts` verifica che istanze store indipendenti vedano lo stesso contatore.
- [ ] Aggiungere test di sicurezza periodici, scansione delle dipendenze, patching e test di ripristino.
- [ ] Valutare DSA per le schede pubbliche e implementare una procedura di segnalazione prima di promuovere la funzione.
- [ ] Far revisionare il contratto di abbonamento e i diritti del consumatore da un professionista competente.

**Non descrivere Vivarqo come “GDPR compliant”, “DSA compliant” o “conforme a tutte le leggi mondiali” finché i punti organizzativi e di prodotto sopra non sono stati verificati e documentati.**


## 5. Aggiornamento 30 ottobre 2026 — account e push

- Preferenze utente persistenti aggiunte con migrazione Prisma: unità di peso/temperatura, formato data, landing page, tema e tabelle compatte.
- Cancellazione self-service: autenticazione con password attuale e doppia conferma; cancellazione dei dati gestionali e dei file privati; annullamento Stripe prima dell'eliminazione; tombstone account anonimizzata. Un errore Stripe/storage blocca la cancellazione per evitare dati orfani o addebiti ricorrenti.
- Storico push persistente: ogni tentativo è collegato ad account, notifica e, se ancora esistente, sottoscrizione del browser. Retry con backoff, recupero claim dopo lease, rimozione endpoint 404/410. La consultazione non espone endpoint push né chiavi crittografiche.
- Retention dello storico push: 90 giorni. Va rivista insieme alla policy privacy e alla retention di log/backup.
- Scelta architetturale: notifiche push e job import/export usano code PostgreSQL-native con lease, claim e retry; non è stata aggiunta una dipendenza esterna come pg-boss. I test provider/browser reali restano una verifica operativa distinta.


## 6. Aggiornamento 30 ottobre 2026 — job dati e documentazione legale

- Import ed export sono accodati nelle tabelle PostgreSQL esistenti; conferme e richieste rispondono `202`. I worker usano claim atomico `FOR UPDATE SKIP LOCKED`, heartbeat, token UUID di proprietà della lease, recupero dei job abbandonati e massimo tre tentativi.
- Gli export continuano a produrre CSV/ZIP in streaming su file temporanei privati. Non è stata aggiunta una coda esterna: le repliche API condividono lo stato tramite PostgreSQL.
- Il workflow CI è configurato per un backup/restore drill su un database temporaneo del PostgreSQL effimero.
- Il workflow manuale staging richiede `STAGING_DATABASE_URL` e un ruolo autorizzato a creare/eliminare database; ripristina solo nel database temporaneo e non modifica il database sorgente.
- Gli script Stripe Test Mode e Web Push effettuano chiamate reali solo quando eseguiti esplicitamente con chiavi e sottoscrizioni di test. Non sono eseguiti automaticamente dalla CI.
- Le bozze in `docs/legal/` contengono segnaposto per informazioni che il codice non può conoscere. Non pubblicarle né dichiarare conformità prima di compilazione, verifica dei provider e revisione professionale.


## Aggiornamento 11 novembre 2026 — deployment e rate limiting

La configurazione production/staging e le relative istruzioni sono in [production-deployment.md](production-deployment.md). Il Compose locale è development-only; lo stack production/staging usa file-backed secrets, Caddy per TLS, reti interne, ruoli PostgreSQL separati (admin per migrazioni, ruolo DML non-superuser per API/worker e ruolo read-only per backup) e un servizio backup verso un bind mount host indipendente dal volume DB.

Il limite generale API non è per-processo: `app.ts` monta `persistentRateLimit(300, "api-global")`, che utilizza il contatore PostgreSQL HMAC. La verifica d'integrazione crea due istanze store separate e dimostra la condivisione del contatore.

La replica off-site cifrata dei backup, il secret manager effettivo, il rinnovo TLS sul dominio reale e il restore su host alternativo richiedono ancora configurazione e prove nell'infrastruttura scelta. Non considerarli verificati dal solo file Compose.
