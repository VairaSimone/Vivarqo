# Informativa cookie e altri strumenti di tracciamento — Vivarqo (bozza)

> **BOZZA INTERNA — NON PUBBLICARE PRIMA DI UN CONTROLLO TECNICO DELLA VERSIONE DISTRIBUITA.** Il contenuto del repository non dimostra quali cookie o script siano effettivamente caricati in produzione.

**Titolare:** [RAGIONE SOCIALE / NOME] — **Contatto:** [EMAIL PRIVACY] — **Versione:** [DATA]

## 1. Ambito

Questa informativa descrive cookie e tecnologie analoghe usati dal sito e dall'applicazione Vivarqo, compresi strumenti di tracciamento attivi/passivi, SDK, tag, risorse di terze parti, CDN e componenti aggiunti dall'infrastruttura.

La classificazione dipende dalle finalità e dal funzionamento effettivo dello strumento, non soltanto dal nome o dalla durata.

## 2. Rilievi preliminari sul codice

Nel repository sono presenti funzioni di autenticazione e protezione CSRF che possono utilizzare cookie tecnici. Nel repository esaminato non è stato individuato un SDK esplicito di analytics o advertising; questo rilievo non sostituisce un'ispezione della build distribuita e delle richieste di rete del dominio pubblico.

Prima della pubblicazione verificare cookie e storage in una nuova sessione browser, richieste di rete prima/dopo autenticazione, script da CDN/tag manager/monitoraggio/widget e risorse aggiunte da hosting o servizi esterni.

## 3. Strumenti strettamente necessari

Gli strumenti strettamente necessari all'autenticazione, alla sicurezza e alla fornitura della funzione esplicitamente richiesta devono essere descritti con nome, finalità, durata e dominio effettivi. Non classificare automaticamente come tecnico uno strumento soltanto perché è proprietario o di prima parte.

## 4. Analytics, marketing e strumenti non necessari

Qualora siano attivati analytics, advertising, profilazione o altri strumenti non strettamente necessari, il titolare deve valutarne la base giuridica e applicare le regole di consenso e informativa pertinenti. Gli strumenti che richiedono consenso non devono essere attivati prima di una scelta valida. Il rifiuto deve essere agevole quanto l'accettazione; deve essere possibile modificare o revocare la scelta.

Non dichiarare l'assenza di cookie di profilazione o di terze parti finché il controllo tecnico della versione pubblica non sia stato eseguito.

## 5. Inventario da completare

| Nome/fornitore | Dominio | Finalità e categoria | Durata | Prima/terza parte | Consenso/base |
|---|---|---|---|---|---|
| [Cookie di sessione] | [DOMINIO] | [AUTENTICAZIONE] | [DURATA] | [PARTE] | [NECESSITÀ TECNICA] |
| [Cookie CSRF] | [DOMINIO] | [PROTEZIONE RICHIESTE] | [DURATA] | [PARTE] | [NECESSITÀ TECNICA] |
| [Cookie o SDK analytics] | [DOMINIO] | [ANALISI] | [DURATA] | [PARTE] | [BASE/CONSENSO] |
| [Altri strumenti rilevati] | [DOMINIO] | [FINALITÀ] | [DURATA] | [PARTE] | [BASE/CONSENSO] |

## 6. Banner e preferenze

**[DESCRIVERE BANNER, SCELTE DISPONIBILI, RIFIUTO, GRANULARITÀ, MEMORIZZAZIONE DELLA SCELTA E LINK PER MODIFICARLA/REVOCARE. Se non sono usati strumenti che richiedono consenso, dichiarare solo quanto verificato.]**

## 7. Contatti e riferimento

Per richieste: **[EMAIL PRIVACY]**. Coordinare il testo con l'informativa privacy e verificare l'art. 122 del Codice Privacy, la direttiva ePrivacy e le [Linee guida cookie del Garante del 10 giugno 2021](https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/docweb/9677876).
