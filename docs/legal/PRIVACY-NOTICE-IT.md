# Informativa sul trattamento dei dati personali — Vivarqo (bozza)

> **BOZZA INTERNA — NON PUBBLICARE SENZA COMPLETAMENTO E REVISIONE LEGALE.** I campi tra parentesi quadre devono essere verificati dal titolare. Il testo non costituisce parere legale né certificazione di conformità.

**Versione:** [NUMERO] — **Ultimo aggiornamento:** [DATA] — **In vigore dal:** [DATA]

## 1. Titolare del trattamento

Il titolare è **[RAGIONE SOCIALE / NOME E COGNOME]**, con sede in **[INDIRIZZO COMPLETO]**, C.F./P.IVA **[DATI]**.

Contatti privacy: **[EMAIL PRIVACY]** — PEC: **[PEC, SE PRESENTE]**.  
Responsabile della protezione dei dati (DPO/RPD): **[DATI SOLO SE FORMALMENTE NOMINATO; ALTRIMENTI ELIMINARE IL PARAGRAFO]**.

## 2. Servizio e ambito

Vivarqo è un servizio online che permette agli utenti di organizzare informazioni su animali, registri di cura, attività, riproduzioni, documenti, inventario, dati economici gestionali, notifiche e condivisioni pubbliche volontarie. L'informativa riguarda sito, applicazione web/PWA, API e servizi esterni effettivamente configurati.

## 3. Categorie di dati

A seconda delle funzioni utilizzate, possono essere trattati:

- **Account e autenticazione:** nome visualizzato, email, hash della password, verifica dell'indirizzo, preferenze di lingua e fuso orario, sessioni e token tecnici conservati in forma hash.
- **Dati gestionali inseriti dall'utente:** schede animali, identificativi, specie, morph, note, pesi, alimentazioni, mute, attività, riproduzioni, incubazione, piccoli, inventario, movimenti e registrazioni economiche.
- **Documenti e allegati:** file, nome originale, tipo, dimensione, categoria, note e riferimenti al contenuto.
- **Condivisioni pubbliche:** campi della scheda animale scelti dall'utente per la pubblicazione, slug casuale e stato della condivisione. L'utente deve evitare di pubblicare dati personali di terzi senza titolo.
- **Notifiche e Web Push:** preferenze, notifiche, endpoint e chiavi della sottoscrizione del browser.
- **Abbonamenti e pagamenti:** identificativi cliente/abbonamento Stripe, piano, stato della sottoscrizione ed eventi di pagamento/webhook. Il backend Vivarqo non memorizza il numero completo della carta; la gestione del pagamento avviene tramite il provider.
- **Dati tecnici e sicurezza:** timestamp, log minimizzati, user-agent quando raccolto, identificatori tecnici e hash di indirizzi IP utilizzati per i controlli di sicurezza.

Non inserire nei campi note categorie particolari di dati o informazioni di terzi non necessarie al servizio.

## 4. Finalità e basi giuridiche

La tabella è una mappatura tecnica proposta. Il titolare deve approvare le finalità e la base applicabile a ciascun trattamento prima della pubblicazione.

| Finalità | Categorie di dati | Base giuridica da verificare |
|---|---|---|
| Registrazione, accesso, gestione account ed erogazione delle funzioni richieste | Account, autenticazione e dati gestionali | Esecuzione del contratto o misure precontrattuali (art. 6, par. 1, lett. b GDPR), ove applicabile |
| Gestione di abbonamento, pagamenti, fatturazione e assistenza | Dati account, identificativi Stripe e stato piano | Contratto e obbligo legale (art. 6, par. 1, lett. b/c GDPR), nei limiti applicabili |
| Sicurezza, prevenzione frodi e abusi, disponibilità del servizio | Log minimizzati, dati tecnici e identificativi di sicurezza | Legittimo interesse documentato (art. 6, par. 1, lett. f GDPR), previa valutazione |
| Notifiche operative e invii richiesti dall'utente | Email, preferenze, notifiche e sottoscrizioni push | Contratto/servizio richiesto e, dove necessario, consenso o altra base da individuare |
| Adempimenti amministrativi, contabili e fiscali | Dati necessari agli adempimenti | Obbligo legale (art. 6, par. 1, lett. c GDPR) |

Non utilizzare la tabella come dichiarazione definitiva senza verificare i flussi email/push, le finalità antifrode e gli obblighi amministrativi concretamente applicabili. Non utilizzare i dati per marketing o profilazione senza averne valutato autonomamente basi giuridiche e obblighi informativi/di consenso.

## 5. Conferimento dei dati

I dati necessari a creare l'account e fornire le funzioni richieste sono necessari per la conclusione e l'esecuzione del rapporto. I dati inseriti nei moduli di gestione sono facoltativi, ma la mancata compilazione impedisce l'uso della funzione corrispondente. I dati di pagamento richiesti dal provider sono necessari per attivare un piano a pagamento.

## 6. Destinatari e responsabili del trattamento

Il titolare deve completare questa sezione con denominazioni legali, ruoli e sedi dei provider reali:

| Servizio | Provider e ruolo da indicare |
|---|---|
| Hosting e runtime API/frontend | [RAGIONE SOCIALE, SEDE, RUOLO] |
| PostgreSQL e backup | [FORNITORE, REGIONE, RUOLO] |
| Object storage privato | [FORNITORE, REGIONE, RUOLO] |
| Email transazionali | [FORNITORE, SEDE, RUOLO] |
| Pagamenti e abbonamenti | [ENTITÀ STRIPE CONTRATTUALE, RUOLO E LINK AL DPA/INFORMATIVA] |
| CDN, monitoraggio, error tracking e supporto | [FORNITORI E RUOLI, SE ATTIVI] |

Verificare gli accordi ex art. 28 GDPR, i sub-responsabili, le regioni di archiviazione, gli accessi del supporto e le misure contrattuali. Le autorità pubbliche possono ricevere dati quando previsto dalla legge.

## 7. Trasferimenti al di fuori dello Spazio economico europeo

**[INDICARE SE PROVIDER, SUB-RESPONSABILI O PERSONALE DI SUPPORTO POSSONO ACCEDERE/TRATTARE DATI FUORI DALLO SEE, I PAESI COINVOLTI E IL MECCANISMO DI TRASFERIMENTO: DECISIONE DI ADEGUATEZZA, SCC E MISURE SUPPLEMENTARI O ALTRO STRUMENTO VALIDO.]**

Non dichiarare che tutti i dati restano nell'UE finché hosting, backup, email, pagamenti, assistenza e sub-responsabili non siano stati verificati contrattualmente e tecnicamente.

## 8. Periodi di conservazione

I periodi devono essere determinati dal titolare sulla base delle finalità e degli obblighi applicabili, documentati e applicati anche a backup e fornitori. Il codice include scadenze tecniche per sessioni/token, anteprime di import, export e tentativi push terminali; tali scadenze non definiscono da sole la retention dell'intero account.

| Categoria | Periodo o criterio da approvare |
|---|---|
| Account attivo e dati gestionali | [DURATA DEL RAPPORTO E CRITERIO SUCCESSIVO] |
| Account cancellato e tombstone tecnica | [DURATA, DATI MINIMIZZATI E MOTIVAZIONE] |
| Documenti/allegati cancellati | [TEMPO DI ELIMINAZIONE DALLO STORAGE E DAI BACKUP] |
| Log sicurezza e audit | [PERIODO E CRITERI] |
| Backup | [RETENTION, ROTAZIONE, OFF-SITE E CANCELLAZIONE] |
| Dati contabili/fiscali | [PERIODO PREVISTO DALLA NORMATIVA APPLICABILE] |
| Notifiche e tentativi Web Push | [PERIODO; IL CODICE PREVEDE ATTUALMENTE 90 GIORNI PER I TENTATIVI TERMINALI] |

## 9. Diritti degli interessati

Nei limiti e alle condizioni previste dal GDPR, l'interessato può chiedere accesso, rettifica, cancellazione, limitazione, opposizione e portabilità; può revocare il consenso quando il trattamento si basa sul consenso, senza pregiudicare la liceità del trattamento precedente. Può inoltre proporre reclamo al Garante per la protezione dei dati personali.

Per esercitare i diritti: **[EMAIL O CANALE PRIVACY]**. Il titolare risponderà nei termini previsti dalla normativa. Potranno essere richieste informazioni ragionevoli per verificare l'identità del richiedente.

## 10. Sicurezza

Nel codice sono presenti misure quali hash Argon2id delle password, token di sessione conservati come hash, protezioni CSRF, controlli di autorizzazione per account, storage privato per documenti e minimizzazione dei log. Le misure infrastrutturali — cifratura a riposo, gestione chiavi, backup, accessi amministrativi, patching e incident response — devono essere descritte solo dopo la verifica dell'ambiente effettivo.

## 11. Processo decisionale automatizzato

**[CONFERMARE SE IL SERVIZIO ADOTTA DECISIONI BASATE UNICAMENTE SU TRATTAMENTI AUTOMATIZZATI, INCLUSI PROFILAZIONE, CHE PRODUCANO EFFETTI GIURIDICI O ANALOGAMENTE SIGNIFICATIVI. Se non presenti, dichiararlo solo dopo verifica.]**

## 12. Minori

Destinatari del servizio ed eventuale età minima: **[DEFINIRE DOPO VALUTAZIONE LEGALE E VERIFICA DEI PAESI SERVITI]**.

## 13. Aggiornamenti

Versione aggiornata: **[URL STABILE]**. Le modifiche saranno comunicate con modalità adeguate alla loro rilevanza.

## Riferimenti

- [Regolamento (UE) 2016/679 (GDPR)](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=it).
- [Linee guida cookie del Garante](https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/docweb/9677876).
