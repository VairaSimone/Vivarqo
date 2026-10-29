# Cookie Policy e tecnologie del browser — modello da completare

> **BOZZA NON PUBBLICABILE.** Questa pagina non presume che il sito usi solo cookie tecnici o che non impieghi analytics. Compilare il registro dopo un audit del sito distribuito e dell'app autenticata. Le linee guida del Garante italiano includono anche strumenti di tracciamento diversi dai cookie: https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/docweb/9677876

**Titolare:** [denominazione e contatto]  
**Versione / data:** [numero / data]

## 1. Tecnologie effettivamente usate

Inventariare cookie HTTP, localStorage/sessionStorage, service worker/cache, Web Push, SDK, pixel, analytics, script di terze parti, font remoti, anti-abuse e identificatori lato server. Non limitare l'audit ai cookie visibili nel browser. Includere anche i pixel di tracciamento nelle email e le impostazioni del provider di invio: il Garante ha adottato linee guida dedicate il 17 aprile 2026 (Doc. web 10241943, pubblicato in G.U. il 29 aprile 2026). Verificare informativa, eccezioni applicabili, consenso preventivo quando richiesto e revoca granulare: https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/10241943.

| Nome/tecnologia | Prima/terza parte | Finalità | Dati | Durata | Base/consenso richiesto? | Come disattivare |
|---|---|---|---|---|---|---|
| [session cookie effettivo] | [parte] | [sessione] | [identificatore] | [durata reale] | [necessità da validare] | [procedura] |
| [CSRF token/cookie effettivo] | [parte] | [sicurezza richiesta] | [token] | [durata reale] | [necessità da validare] | [procedura] |
| [service worker/cache effettivo] | [parte] | [asset offline] | [risorse memorizzate] | [durata reale] | [verificare applicabilità] | [procedura cancellazione] |
| [analytics/marketing, solo se presenti] | [parte] | [finalità] | [eventi/identificatori] | [durata] | [consenso/base applicabile] | [gestione preferenze] |

## 2. Scelte dell'utente

Descrivere le categorie per le quali viene richiesto consenso, come rifiutare senza perdere le funzioni non collegate, come modificare/revocare la scelta e come la scelta viene registrata. Non caricare tracker non essenziali prima del consenso quando questo è richiesto. La chiusura del banner non deve essere trattata come consenso se la scelta non è inequivocabile.

## 3. Tecnologie strettamente necessarie

Spiegare ciascuna tecnologia strettamente necessaria all'autenticazione, alla sicurezza e alla funzione esplicitamente richiesta, con nome, scopo, durata e modalità di gestione. La classificazione deve derivare dall'uso reale e non dal nome assegnato al cookie.

## 4. Terze parti e trasferimenti

Elencare script, domini, provider, funzione, dati inviati, regioni e link alle informative pertinenti. Verificare l'esecuzione effettiva della rete in uno stato senza consenso e dopo rifiuto.

## 5. Come cancellare o modificare i dati del browser

Indicare come modificare la scelta nel pannello del sito, cancellare i dati del sito nel browser e gestire la sottoscrizione Web Push. La cancellazione della cache del browser non equivale alla cancellazione dei dati server-side.

## 6. Contatti e aggiornamenti

Per domande contattare [email privacy]. Questa policy sarà aggiornata quando cambieranno strumenti, fornitori o finalità e pubblicherà una data/versione.