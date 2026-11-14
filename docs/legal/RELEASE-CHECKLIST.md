# Checklist rilascio privacy e conformità — SnakeBee

> Non considerare questa checklist superata perché le pagine sono state implementate: la pubblicazione definitiva richiede evidenze tecniche e approvazione del titolare/professionista.

## Identità e documenti
- [ ] Inserire ragione sociale/nome, sede, CF/P.IVA, email, PEC e contatto privacy.
- [ ] Verificare DPO/RPD, età minima, paesi serviti e lingue.
- [ ] Approvare finalità, basi giuridiche, categorie, destinatari e trasferimenti.
- [ ] Completare retention per account, log, file, backup, contabilità e notifiche.
- [ ] Approvare privacy notice, cookie notice, termini, condizioni abbonamento e accessibilità.

## Frontend e prodotto
- [x] Collegamenti pubblici a privacy, cookie e termini in registrazione.
- [x] Accettazione esplicita dei termini in registrazione (non consenso privacy generico).
- [x] Centro privacy con accesso a export, correzione account e cancellazione account.
- [ ] Tradurre e revisionare integralmente tutti i documenti per ogni lingua servita.
- [x] Registrare lato server versione e timestamp di accettazione dei termini in fase di registrazione.
- [ ] Definire il processo di nuova accettazione quando i termini vengono modificati e conservare le versioni storiche pubblicate.

## Cookie e tracciamento
- [ ] Audit su dominio/build reali: cookie, storage, richieste, CDN, analytics, error tracking e widget.
- [ ] Se tracker non essenziali: CMP, blocco preventivo, rifiuto/accettazione equivalenti, granularità e revoca.
- [ ] Verificare che nessun tracker parta prima del consenso e testare revoca.

## Backend e organizzazione
- [ ] Verificare cancellazione/cascade su DB, object storage, provider, backup e link pubblici.
- [ ] Implementare/validare flusso richieste GDPR, identity check, SLA e audit log minimizzato.
- [ ] Verificare DPA art. 28, sub-responsabili, regioni, SCC e misure supplementari.
- [ ] Approvare retention e job automatici di cancellazione/anonimizzazione.
- [ ] Registro trattamenti ove dovuto, DPIA se necessaria, incident response e data breach (72h quando dovuto).
- [ ] Valutare DSA per pagine pubbliche, Consumer Code, servizi digitali, fiscalità e EAA/WCAG.
- [ ] Pen test, access control, CSRF, backup restore, log minimization e incident tabletop.

## Rilascio
- [ ] Nessun placeholder [..] nei documenti pubblici.
- [ ] Checkout, prezzi, IVA, rinnovo, recesso e disdetta coerenti con condizioni.
- [ ] Revisione legale e privacy professionale documentata.
- [ ] Test E2E accessibilità, lingua, navigazione mobile e flussi diritti.
