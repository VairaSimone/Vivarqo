# Checklist per il rilascio dei documenti legali e privacy

> Le informative sono bozze: non pubblicarle finché i punti obbligatori non sono verificati e approvati.

## Dati che solo il gestore può fornire

- [ ] Ragione sociale/nome e cognome del titolare, sede, C.F./P.IVA, email e PEC.
- [ ] Decisione sull'eventuale nomina di un DPO/RPD e relativi contatti.
- [ ] Età minima, paesi/mercati serviti e lingue delle informative.
- [ ] Provider reali e relative entità legali: hosting, database, storage, backup, email, Stripe, CDN, monitoraggio e supporto.
- [ ] Regioni effettive, accessi del personale/subfornitori e trasferimenti fuori dallo SEE.
- [ ] DPA, sub-responsabili, SCC/garanzie e verifiche dei provider.
- [ ] Finalità e basi giuridiche approvate per account, sicurezza, email, push, pagamenti e assistenza.
- [ ] Retention per account attivi/cancellati, tombstone, file eliminati, log, audit, notifiche, backup e contabilità.
- [ ] Piani, prezzi, IVA, trial, rinnovi, disdetta, recesso, rimborsi e flusso di cancellazione.
- [ ] Canale per diritti degli interessati, reclami e data breach.
- [ ] Valutazione DSA per la condivisione pubblica e delle eventuali procedure di segnalazione/gestione contenuti.

## Verifiche tecniche

- [ ] Inventario cookie e richieste di rete su produzione, browser pulito e dispositivi mobili.
- [ ] Verifica analytics, tag manager, advertising, monitoraggio e widget caricati fuori dal repository.
- [ ] Se necessari, blocco preventivo degli strumenti che richiedono consenso, rifiuto, granularità e revoca.
- [ ] Verifica dell'effettiva cancellazione account, documenti, oggetti storage, riferimenti Stripe e copie residue nei backup.
- [ ] Verifica cifratura database/storage/backup, secret manager e accessi amministrativi.
- [ ] Approvazione della matrice finalità/basi giuridiche e del piano di conservazione.
- [ ] Verifica che i termini descrivano esattamente il comportamento del checkout e delle schermate.

## Approvazione e pubblicazione

- [ ] Revisione da parte di un professionista privacy/legale competente.
- [ ] Approvazione documentata del titolare.
- [ ] Versione, data di efficacia e URL stabili.
- [ ] Link visibili in registrazione, impostazioni, checkout e footer, ove pertinente.
- [ ] Processo per aggiornare i testi quando cambiano finalità, provider, prezzi o funzioni.
