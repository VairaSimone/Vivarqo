VIVARQO
Specifica tecnica del prodotto e dell’architettura
Versione: 1.0
Data: 27 ottobre 2026
Stato: specifica di riferimento per l’implementazione
Prodotto: PWA gestionale per piccoli e medi allevatori di rettili
________________________________________
Indice
1.	Scopo del documento
2.	Identità e perimetro
3.	Funzioni incluse nel prodotto
4.	Stack tecnologico obbligatorio
5.	Architettura applicativa
6.	Account, autenticazione e impostazioni
7.	Home Oggi
8.	Anagrafica degli animali
9.	Alimentazioni
10.	Mute, pesi e osservazioni
11.	Attività, calendario e promemoria
12.	Riproduzioni, covate, incubazione e piccoli
13.	Inventario
14.	Documenti, QR e pagine pubbliche
15.	Morph e dati genetici
16.	Registro di spese e ricavi
17.	Importazione ed esportazione dati
18.	Abbonamenti e pagamenti
19.	Notifiche
20.	API REST
21.	Modello dati relazionale
22.	Interfaccia grafica e design system
23.	PWA e notifiche browser
24.	Sicurezza, privacy e affidabilità
25.	Test e criteri di accettazione
26.	Distribuzione e ambienti
27.	Fasi d’implementazione
28.	Elementi commerciali da configurare
29.	Riferimenti tecnici ufficiali
1. Scopo del documento
Questo documento definisce in modo operativo il prodotto Vivarqo: moduli, comportamento delle funzioni, architettura software, stack tecnologico, modello relazionale dei dati, API, interfaccia grafica, sicurezza, test e distribuzione.
Le scelte tecniche riportate qui sono vincolanti per la prima implementazione. Il documento non attribuisce al progetto decisioni commerciali mai definite: prezzo, limiti del piano gratuito, soglie di utilizzo e calendario commerciale vengono configurati prima del lancio e non sono codificati nell’applicazione.
Il progetto è una nuova applicazione. Il repository di SnakeBee è una fonte di riferimento leggibile.
2. Identità e perimetro
•	Nome: Vivarqo.
•	Destinatari: piccoli e medi allevatori di rettili; il riferimento operativo è un allevamento con circa 20–150 esemplari.
•	Forma: applicazione web mobile-first, installabile come Progressive Web App (PWA).
•	Lingua iniziale dell’interfaccia: Italiano e inglese
•	Fuso orario predefinito per un nuovo account: Europe/Rome; ogni account può modificarlo.
•	Modello dati: multi-tenant logico, con dati privati separati per account.
•	Piattaforme iniziali: browser desktop e mobile compatibili con gli standard web moderni. Non è prevista una build nativa Android/iOS nella prima release.
•	Connessione: le operazioni che leggono o modificano dati richiedono connettività. La PWA può memorizzare i file statici dell’interfaccia per l’apertura rapida, ma la prima release non supporta la modifica offline e la sincronizzazione differita.
•	Account: nella prima release ogni account appartiene a un singolo allevatore. Non sono previsti ruoli collaborativi o account condivisi.
3. Funzioni incluse nel prodotto
La piattaforma è composta dai seguenti moduli:
1.	Account, accesso e impostazioni.
2.	Home operativa «Oggi».
3.	Anagrafica degli animali.
4.	Alimentazioni e registrazioni multiple.
5.	Mute, pesi e osservazioni.
6.	Attività e promemoria.
7.	Importazione ed esportazione.
8.	Riproduzioni, covate, uova, incubazioni e piccoli.
9.	Inventario e movimenti di magazzino.
10.	Documenti privati e schede pubbliche con QR.
11.	Registrazione di morph e dati genetici dichiarati dall’allevatore.
12.	Registro economico di spese e ricavi.
13.	Abbonamento e gestione pagamenti tramite Stripe.
14.	Notifiche in-app e notifiche push web.
15.	Esportazione e cancellazione dei dati dell’account.
La community, il marketplace, la messaggistica tra allevatori, la gestione di vendite come negozio online, il calcolo genetico automatico e la diagnostica veterinaria non fanno parte del perimetro definito. Il prodotto registra informazioni inserite dall’utente; non formula diagnosi né sostituisce il giudizio di un veterinario o dell’allevatore.
4. Stack tecnologico obbligatorio
Area	Tecnologia	Impiego
Frontend	React + TypeScript	Interfaccia a componenti, tipi condivisi e schermate applicative
Build e dev server	Vite	Sviluppo locale, build e ottimizzazione degli asset
PWA	vite-plugin-pwa + Workbox	Web manifest, service worker e caching degli asset statici
Stile	Tailwind CSS	Layout responsive e design tokens
Componenti UI	Radix UI tramite componenti shadcn/ui	Dialog, menu, tooltip, selettori e componenti accessibili
Routing frontend	React Router	Navigazione e rotte applicative/pubbliche
Dati remoti frontend	TanStack Query	Fetch, cache, invalidazione e stati di caricamento delle API
Form	React Hook Form + Zod	Moduli controllati e validazione lato client; validazione replicata sul server
Grafici	Recharts	Grafici dello storico del peso e riepiloghi finanziari
Backend	Node.js 24 LTS + TypeScript + Express 5	REST API, regole applicative, autorizzazione, webhook e job applicativi
Validazione API	Zod	Validazione request/response e schemi condivisi in un package interno
Database	PostgreSQL 18	Database relazionale primario
ORM e migrazioni	Prisma ORM stabile	Accesso tipizzato al DB e migrazioni versionate
Autenticazione	Sessioni server-side con cookie sicuri	Accesso account senza token di sessione in localStorage
Password	Argon2id	Hash delle password
Pagamenti	Stripe Checkout, Billing, Customer Portal e webhook	Sottoscrizioni, eventi pagamento e gestione abbonamento
Email transazionali	Resend	Verifica email, recupero password e messaggi di servizio
File e immagini	Storage oggetti compatibile S3 in regione UE	Foto animali e documenti, con accesso privato firmato
Test unitari	Vitest	Test frontend/backend e logica applicativa
Test UI	React Testing Library	Verifica dei comportamenti dei componenti
Test API	Supertest	Test integrazione delle rotte Express
Test end-to-end	Playwright	Flussi reali del browser
Job e attività in background	pg-boss su PostgreSQL	Pianificazione di notifiche, import/export ed elaborazioni asincrone senza introdurre Redis
Monitoraggio errori	Sentry	Raccolta errori applicativi con filtraggio dei dati sensibili
Contenitori	Docker	Esecuzione riproducibile di API e strumenti di sviluppo
Contratto API	OpenAPI 3	Specifica documentata delle API REST
Le dipendenze devono usare release stabili compatibili tra loro. Le versioni esatte vengono bloccate nel lockfile del repository e aggiornate con test automatici. Non utilizzare release alpha, beta o release candidate in produzione.
4.1 Struttura del repository applicativo
Il nuovo progetto usa un monorepo pnpm:
vivarqo/
  apps/
    web/                 # React, Vite, PWA
    api/                 # Express REST API
  packages/
    contracts/           # schemi Zod e tipi API condivisi
    ui/                  # componenti condivisi quando utili
  prisma/
    schema.prisma
    migrations/
    seed.ts
  docs/
    openapi.yaml
  infra/
    docker/
  .github/workflows/     # CI; non eseguire deploy senza approvazione
Il frontend non accede direttamente al database. Tutte le operazioni sui dati passano dall’API autenticata, ad eccezione delle pagine pubbliche che utilizzano endpoint dedicati e limitati ai campi espressamente pubblicabili.
5. Architettura applicativa
Browser / PWA
    │ HTTPS
    ▼
React + Vite
    │ REST / JSON + cookie di sessione
    ▼
Express API (Node.js)
    ├── PostgreSQL 18 via Prisma
    ├── Storage S3 compatibile per file
    ├── Resend per email transazionali
    └── Stripe per billing e webhook
L’applicazione è organizzata in moduli di dominio: auth, animals, care-events, tasks, reproduction, inventory, documents, public-shares, imports, billing, notifications e finance.
Ogni modulo contiene route/controller, schema di validazione, servizio applicativo e accesso ai dati. Le route non devono contenere direttamente logica di business complessa. Le operazioni multi-tabella sono eseguite in transazioni PostgreSQL. I job asincroni e pianificati sono gestiti da pg-boss, con PostgreSQL come coda persistente; il worker deve poter ritentare un job fallito senza duplicare effetti.
5.1 Convenzioni generali
•	Tutte le rotte API private iniziano con /api/v1.
•	Il formato di scambio è JSON; upload di file tramite multipart/form-data verso endpoint dedicati.
•	Le risposte di errore hanno un formato coerente: code, message, details e requestId.
•	Le liste usano paginazione basata su cursore o pagina esplicita, con limiti massimi server-side.
•	Date/ore tecniche: timestamptz UTC nel database; visualizzazione nel fuso orario dell’account.
•	Date senza orario, come nascita o deposizione, sono memorizzate come date.
•	Importi monetari: interi in centesimi di euro; mai usare floating point per il denaro.
•	Peso: numeric(10,2) in grammi.
•	Temperatura: numeric(5,2) in gradi Celsius.
•	Quantità inventario: numeric(12,3) con unità esplicita.
•	Identificativi interni: UUID.
6. Account, autenticazione e impostazioni
6.1 Registrazione e accesso
Funzioni:
•	Registrazione con nome visualizzato, email e password.
•	Verifica dell’indirizzo email.
•	Accesso e disconnessione.
•	Recupero password tramite link monouso con scadenza.
•	Revoca della sessione corrente e di tutte le sessioni dell’account.
•	Modifica di nome, email, password, lingua e fuso orario.
•	Richiesta di esportazione dei dati e cancellazione dell’account.
6.2 Regole di sicurezza della sessione
•	Cookie HttpOnly, Secure in produzione e SameSite=Lax.
•	Token di sessione casuale ad alta entropia; nel database è salvato il relativo hash, non il token riutilizzabile in chiaro.
•	Scadenza e rinnovo della sessione definiti lato server.
•	Protezione CSRF su tutte le operazioni mutative autenticate.
•	Rate limiting su login, registrazione, recupero password, importazioni e creazione di link pubblici.
•	Nessun token di sessione in localStorage o sessionStorage.
•	Password memorizzate esclusivamente tramite Argon2id con parametri aggiornati e versionati.
6.3 Impostazioni
Ogni account mantiene lingua, fuso orario, unità di misura (peso in grammi e temperatura in °C come default), preferenze di notifica e preferenze di visualizzazione. La lingua iniziale dell’interfaccia è italiano.
7. Home «Oggi»
È la schermata iniziale dopo l’accesso. Aggrega informazioni operative senza duplicare il dato originale.
Contenuti:
•	Attività in scadenza oggi.
•	Attività scadute e ancora aperte.
•	Riepilogo delle attività completate oggi.
•	Accesso rapido alla registrazione multipla di alimentazioni.
•	Promemoria imminenti.
•	Eventi recenti dell’allevamento.
Ogni riga di attività deve mostrare titolo, data di scadenza, stato e animale associato quando presente. L’utente può aprire il record, completare l’attività o modificarne la scadenza.
Il riepilogo non crea dati duplicati: legge task, regole di promemoria ed eventi reali. Eventuali contatori sono calcolati a partire dai record persistiti.
8. Anagrafica degli animali
8.1 Campi
Ogni animale contiene:
•	Nome visualizzato, obbligatorio.
•	Codice/identificativo interno, facoltativo ma univoco nell’account se valorizzato.
•	Specie, obbligatoria come testo selezionato o inserito dall’utente.
•	Sesso: male, female, unknown.
•	Morph, facoltativo.
•	Annotazioni genetiche testuali, facoltative.
•	Data di nascita, facoltativa, e indicatore di data stimata.
•	Data di acquisizione, facoltativa.
•	Provenienza e allevatore precedente, facoltativi.
•	Posizione/alloggiamento, facoltativa.
•	Stato: active, sold, transferred, deceased, archived.
•	Note generali.
•	Chiave di storage della foto principale, se presente.
•	Collegamento all’eventuale covata o gruppo di nascita di origine.
8.2 Operazioni
•	Crea, visualizza, modifica e archivia un animale.
•	Ricerca per nome o identificativo.
•	Filtri per specie, sesso, morph, stato e posizione.
•	Ordinamento per nome, data di creazione e ultima attività.
•	Visualizzazione della cronologia individuale.
•	Accesso alle azioni rapide: alimentazione, peso, muta, nota, documento e condivisione pubblica.
•	Eliminazione definitiva solo tramite flusso esplicito e dopo aver informato l’utente delle relazioni che verrebbero rimosse. Gli animali storici devono normalmente essere archiviati, non eliminati.
Le schede degli animali archiviati rimangono ricercabili tramite filtro. Gli animali venduti, trasferiti o deceduti non compaiono nelle liste operative attive, ma restano disponibili nello storico.
9. Alimentazioni
9.1 Registrazione singola
Un record di alimentazione contiene animale, data/ora dell’offerta, esito, tipo di alimento, descrizione della dimensione/quantità, peso dell’alimento in grammi se noto e note facoltative.
Esiti ammessi:
•	ate: alimento consumato.
•	refused: alimento rifiutato.
•	not_offered: alimentazione non effettuata.
•	unknown: esito non registrato.
L’assenza di un record non equivale a rifiuto. Il sistema non deve dedurre automaticamente un rifiuto quando un’alimentazione non è stata registrata.
9.2 Registrazione multipla
La schermata di alimentazione multipla consente di selezionare diversi animali e assegnare a ciascuno un risultato indipendente nella stessa sessione. La sessione raggruppa l’operazione, ma ogni animale genera un record individuale.
Flusso: 1. Selezione degli animali attivi. 2. Impostazione comune di data e tipo di alimento, modificabili per singolo animale. 3. Impostazione del risultato per ciascun animale. 4. Riepilogo prima della conferma. 5. Salvataggio atomico della sessione e dei relativi record. 6. Possibilità di correggere un risultato successivamente, mantenendo updated_at e l’evento di audit previsto per modifiche rilevanti.
9.3 Storico e ricerca
La scheda animale mostra lo storico delle alimentazioni in ordine decrescente per data. La sezione globale consente filtri per intervallo temporale, esito e animale.
I suggerimenti sugli animali senza alimentazioni recenti sono basati esclusivamente sui promemoria/intervalli configurati dall’utente; non viene applicato un intervallo biologico universale.
10. Mute, pesi e osservazioni
10.1 Mute
Campi: animale, data/ora, esito (complete, partial, unknown), note.
10.2 Peso
Campi: animale, data/ora della pesata, peso in grammi maggiore di zero, note. La scheda mostra elenco cronologico e grafico. Il grafico mostra i valori effettivamente registrati e non inventa valori mancanti.
10.3 Osservazioni
Campi: animale, data/ora, titolo facoltativo, categoria, testo della nota. Le note sono consultabili dalla cronologia individuale e possono essere modificate o archiviate.
Il prodotto non presenta valutazioni cliniche automatiche, diagnosi o piani veterinari.
11. Attività, calendario e promemoria
Un’attività è un’azione da eseguire, con titolo, descrizione facoltativa, categoria, data/ora di scadenza, stato, eventuale animale associato e data di completamento.
Categorie iniziali: feeding, weighing, shed_check, cleaning, reproduction, document, inventory, custom.
Stati: open, completed, dismissed.
Le regole ricorrenti consentono di definire un intervallo in giorni e il successivo appuntamento. Il completamento di un’attività ricorrente genera la successiva occorrenza senza sovrascrivere lo storico.
Il calendario presenta viste mese, settimana e lista. Gli eventi derivati da record reali (ad esempio deposizione o schiusa) sono visualizzati come eventi di calendario senza richiedere una seconda registrazione manuale.
Le notifiche push web sono abilitate solo dopo consenso esplicito del browser. Una notifica non è l’unico luogo in cui compare l’attività: l’app mantiene sempre il riepilogo in-app.
12. Riproduzioni, covate, incubazione e piccoli
12.1 Ciclo riproduttivo
Un ciclo collega due animali genitori, data iniziale, stato, note e gli eventi riproduttivi associati. I genitori sono riferimenti ad animali già presenti nell’account; la relazione può restare incompleta se il secondo genitore è sconosciuto.
Stati del ciclo: planned, active, completed, cancelled.
12.2 Eventi riproduttivi
Ogni evento è collegato a un ciclo e contiene tipo, data/ora, note e autore. Tipi: pairing, observation, ovulation, gravid, laying, live_birth, incubation_start, hatch, loss, other.
Il catalogo di eventi non presume che ogni fase si applichi a tutte le specie. L’utente registra solo gli eventi pertinenti.
12.3 Covate
Una covata include ciclo di origine, data di deposizione, numero di uova, stato, identificativo, incubatore/posizione e note. Per specie o eventi senza uova si registra un gruppo di nascita invece di creare una covata fittizia.
12.4 Uova e incubazione
Quando l’utente necessita del dettaglio individuale, ogni uovo può avere codice, stato e note. Gli eventi di incubazione conservano data/ora, temperatura in °C, umidità percentuale, tipo di rilevazione e note. I dati devono essere una registrazione storica: le nuove misurazioni non sovrascrivono quelle precedenti.
12.5 Nascite e schede dei piccoli
Un gruppo di nascita collega ciclo e, quando esistente, covata. Registra data, numero di nati e note. Da un gruppo si possono generare schede individuali, ereditando il collegamento all’origine senza duplicare dati dei genitori.
Le schede dei piccoli possono essere create senza compilare subito tutti i campi anagrafici; il sistema assegna un identificativo interno univoco.
13. Inventario
13.1 Articoli
Ogni articolo ha nome, categoria, unità di misura, quantità disponibile, soglia minima, stato attivo/archiviato e note.
Categorie iniziali: alimento, substrato, materiale, attrezzatura, altro.
13.2 Movimenti
Ogni entrata, consumo o correzione genera un movimento append-only con articolo, data, tipo, quantità, costo unitario facoltativo, riferimento/nota e utente. Le quantità sono positive nel campo quantity; la direzione è rappresentata da movement_type (in, out, adjustment). Il saldo viene aggiornato in transazione con il movimento.
L’app mostra saldo, movimenti e avviso di scorta bassa quando il saldo è minore o uguale alla soglia. La prima versione non gestisce fornitori, ordini d’acquisto o fatture passive.
14. Documenti, QR e pagine pubbliche
14.1 Documenti privati
I documenti possono essere associati ad animale o ciclo riproduttivo. Ogni documento conserva nome originale, tipo MIME, dimensione, chiave di storage, data di caricamento, categoria e nota.
I file sono privati per impostazione predefinita. Il server crea URL firmati a scadenza per download autorizzati. Il nome del file non viene utilizzato come percorso fisico.
Sono previsti controlli su estensione, MIME reale, dimensione massima configurata e contenuto ammesso. I documenti non sono analizzati o certificati legalmente da Vivarqo.
14.2 Schede pubbliche e QR
Un utente può abilitare una pagina pubblica per un animale e ottenere il relativo URL e QR code. Ogni pagina ha uno slug non prevedibile, stato abilitato/disabilitato e lista esplicita dei campi pubblicabili.
Campi pubblicabili iniziali: nome scelto per la condivisione, specie, morph, sesso se consentito dall’utente, fotografia selezionata, descrizione pubblica e dati di nascita se espressamente attivati. Email, nome dell’account, note private, documenti privati, cronologia alimentare, peso e posizione non vengono pubblicati automaticamente.
La pagina pubblica è servita da un endpoint pubblico separato, con rate limiting e senza restituire l’intero record privato dell’animale.
15. Morph e dati genetici
La scheda supporta il morph dichiarato dall’utente e righe di annotazione genetica: caratteristica, valore/testo, provenienza se nota, genitore collegato facoltativo e nota.
La prima implementazione non calcola probabilità di ereditarietà, compatibilità di accoppiamento o genotipi dedotti. Non trasforma una nota inserita dall’utente in un dato scientificamente verificato.
16. Registro di spese e ricavi
Il registro economico è un modulo separato che permette di registrare: - Tipo: entrata o uscita. - Data. - Importo in centesimi di euro. - Categoria. - Descrizione. - Animale collegato facoltativo. - Documento allegato facoltativo.
Il riepilogo mostra somme per periodo e categoria. Non è un sistema di contabilità fiscale, fatturazione elettronica o tenuta contabile ufficiale. Non genera automaticamente documenti fiscali.
17. Importazione ed esportazione dati
17.1 Importazione
L’importazione deve accettare CSV UTF-8 e file XLSX. Il flusso prevede: 1. Upload del file in area temporanea privata. 2. Riconoscimento della prima riga come intestazione, con possibilità di selezionare il foglio nei file XLSX. 3. Mappatura assistita delle colonne ai campi Vivarqo. 4. Anteprima delle righe e validazione. 5. Report di errori con numero riga, colonna e motivo. 6. Conferma esplicita dell’utente. 7. Importazione in transazione per ogni gruppo di dati coerente; report finale con record creati, ignorati ed errori.
L’importatore non deve inventare dati mancanti né interpretare automaticamente testo ambiguo. I duplicati sono rilevati attraverso identificativo utente se presente e confronto normalizzato di campi non univoci; i casi ambigui richiedono una decisione dell’utente.
Prima release: importazione delle anagrafiche animali e dei file strutturati di alimentazioni, pesi, mute e note. Il formato di importazione dei cicli riproduttivi è definito con un template dedicato nella release del modulo riproduttivo.
17.2 Esportazione
L’utente può esportare i propri dati in ZIP contenente CSV per le entità tabellari e file associati quando richiesti. Gli export includono identificativi stabili e colonne di relazione per permettere la ricostruzione delle associazioni. I file vengono generati come download autenticato e resi disponibili per un periodo limitato.
La cancellazione dell’account richiede conferma esplicita e applica una procedura documentata per i record e i file collegati, nel rispetto degli obblighi di conservazione eventualmente applicabili.
18. Abbonamenti e pagamenti
Stripe è il sistema di pagamento del piano web. Il backend usa Checkout per l’acquisto, Billing per lo stato della sottoscrizione, Customer Portal per la gestione da parte dell’utente e webhook firmati per sincronizzare gli eventi.
La tabella locale conserva gli identificativi Stripe e lo stato dell’abbonamento per autorizzare le funzioni. Il browser non è fonte autorevole dello stato di pagamento.
Stati gestiti: active, trialing, past_due, incomplete, incomplete_expired, canceled, unpaid, paused (solo se usato dal prodotto Stripe/configurazione).
Regole:
•	Validare la firma di ogni webhook.
•	Rendere i webhook idempotenti mediante memorizzazione dell’ID evento Stripe elaborato.
•	Accettare eventi duplicati senza duplicare effetti.
•	Aggiornare la sottoscrizione tramite API e webhook, non solo dopo il redirect di Checkout.
•	Non salvare dati della carta nel database Vivarqo.
•	Tenere prezzo, ID del Price Stripe, limiti e funzionalità abilitate in configurazione backend; non codificarli nel frontend.
•	La cancellazione e il pagamento fallito devono produrre stati visibili nell’account e un percorso di gestione tramite Customer Portal.
Prezzo, periodo di prova, limiti numerici del piano gratuito e politica di tolleranza non vengono fissati da questo documento perché non risultano decisioni commerciali confermate. Devono essere configurati prima di abilitare gli acquisti.
19. Notifiche
Sono previsti due canali:
•	In-app: sempre disponibili nella schermata «Oggi» e nel centro notifiche.
•	Push web: inviate solo agli utenti che hanno autorizzato il browser e attivato le preferenze.
Le preferenze devono permettere di abilitare/disabilitare categorie e finestre di invio. Il sistema memorizza gli eventi inviati e i tentativi; gestisce gli endpoint scaduti rimuovendo le sottoscrizioni non più valide. La consegna non è garantita dal sistema operativo e non viene presentata come tale nell’interfaccia.
20. API REST
Le API private richiedono sessione valida, protezione CSRF per le richieste mutative e controllo di proprietà su ogni risorsa.
Area	Rotte principali
Auth	POST /auth/register, POST /auth/verify-email, POST /auth/resend-verification, POST /auth/login, POST /auth/logout, POST /auth/forgot-password, POST /auth/reset-password, GET /auth/me
Account	PATCH /account, POST /account/export, DELETE /account
Animali	GET /animals, POST /animals, GET /animals/:id, PATCH /animals/:id, POST /animals/:id/archive, DELETE /animals/:id
Alimentazioni	GET /feeding-sessions, POST /feeding-sessions, GET /feeding-sessions/:id, PATCH /feeding-entries/:id, DELETE /feeding-entries/:id
Peso/mute/note	GET/POST /animals/:id/weights, GET/POST /animals/:id/sheds, GET/POST /animals/:id/notes
Attività	GET/POST /tasks, PATCH /tasks/:id, POST /tasks/:id/complete, GET/POST /reminder-rules
Riproduzioni	GET/POST /reproduction-cycles, GET/PATCH /reproduction-cycles/:id, POST /reproduction-cycles/:id/events, POST /clutches, POST /clutches/:id/incubation-logs, POST /offspring-batches
Inventario	GET/POST /inventory/items, PATCH /inventory/items/:id, POST /inventory/items/:id/movements
Documenti	POST /documents, GET /documents/:id/download, DELETE /documents/:id
Pagine pubbliche	POST /animals/:id/public-share, PATCH /public-shares/:id, GET /public/animals/:slug
Import/export	POST /imports, GET /imports/:id, POST /imports/:id/confirm, POST /exports
Billing	POST /billing/checkout, POST /billing/portal, GET /billing/subscription, POST /webhooks/stripe
Notifiche	GET /notifications, PATCH /notification-preferences, POST /push-subscriptions, DELETE /push-subscriptions/:id
Finanze	GET/POST /finance/entries, PATCH /finance/entries/:id, DELETE /finance/entries/:id
I nomi rappresentano il contratto di riferimento; ogni endpoint deve avere schema request/response in OpenAPI e test di autorizzazione. POST /webhooks/stripe è l’unica rotta esposta per eventi di pagamento e usa il corpo raw richiesto dalla verifica della firma Stripe.
21. Modello dati relazionale
21.1 Regole comuni
•	Tabelle private con user_id obbligatorio oppure relazione obbligatoria verso una risorsa che appartiene a un user_id.
•	Ogni query di risorsa privata verifica proprietario e ID nello stesso percorso applicativo.
•	PK UUID per tutte le entità.
•	created_at e updated_at sulle entità modificabili.
•	Indici su FK, date di consultazione, stato e campi di ricerca.
•	Abilitare l’estensione PostgreSQL citext per l’unicità dell’email senza distinzione tra maiuscole e minuscole.
•	Vincoli CHECK per pesi, importi, percentuali e quantità valide.
•	FK con ON DELETE RESTRICT dove l’eliminazione distruggerebbe lo storico; eliminazioni a cascata solo per dati strettamente dipendenti e dopo verifica delle regole di conservazione.
21.2 Tabelle core
users
id UUID PK, email CITEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name VARCHAR(120) NOT NULL, locale VARCHAR(10) NOT NULL DEFAULT 'it', timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Rome', email_verified_at TIMESTAMPTZ NULL, account_status VARCHAR(20) NOT NULL, created_at, updated_at, deleted_at TIMESTAMPTZ NULL.
user_sessions
id UUID PK, user_id UUID FK, token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, last_seen_at TIMESTAMPTZ NULL, user_agent TEXT NULL, ip_hash TEXT NULL, created_at. L’IP grezzo non viene conservato a tempo indeterminato.
auth_tokens
id UUID PK, user_id UUID FK NOT NULL, token_hash TEXT UNIQUE NOT NULL, token_type VARCHAR(24) NOT NULL, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ NULL, created_at. token_type è verify_email o reset_password; ogni token è monouso, conservato solo come hash e invalidato dopo l’utilizzo o la scadenza.
animals
id UUID PK, user_id UUID FK NOT NULL, name VARCHAR(120) NOT NULL, identifier VARCHAR(120) NULL, species VARCHAR(160) NOT NULL, sex VARCHAR(12) NOT NULL, morph VARCHAR(200) NULL, genetics_notes TEXT NULL, birth_date DATE NULL, birth_date_estimated BOOLEAN NOT NULL DEFAULT FALSE, acquired_date DATE NULL, origin_description TEXT NULL, previous_breeder VARCHAR(160) NULL, location_label VARCHAR(160) NULL, status VARCHAR(20) NOT NULL, notes TEXT NULL, photo_key TEXT NULL, origin_clutch_id UUID NULL, origin_offspring_batch_id UUID NULL, archived_at TIMESTAMPTZ NULL, created_at, updated_at.
Vincoli: sex limitato a male/female/unknown; status a active/sold/transferred/deceased/archived; identificativo univoco per account quando non nullo. Gli FK di origine vengono aggiunti dopo la creazione delle tabelle riproduttive per evitare dipendenze circolari nella migrazione iniziale.
feeding_sessions
id UUID PK, user_id UUID FK NOT NULL, performed_at TIMESTAMPTZ NOT NULL, notes TEXT NULL, created_at, updated_at.
feeding_entries
id UUID PK, session_id UUID FK NOT NULL, animal_id UUID FK NOT NULL, outcome VARCHAR(20) NOT NULL, food_type VARCHAR(120) NULL, food_size VARCHAR(120) NULL, food_weight_g NUMERIC(10,2) NULL, notes TEXT NULL, created_at, updated_at.
Vincoli: outcome in ate/refused/not_offered/unknown; food_weight_g > 0 quando valorizzato. In fase di insert l’API verifica che sessione e animale appartengano allo stesso account.
weight_measurements
id UUID PK, animal_id UUID FK NOT NULL, measured_at TIMESTAMPTZ NOT NULL, weight_g NUMERIC(10,2) NOT NULL CHECK (weight_g > 0), notes TEXT NULL, created_at, updated_at.
shed_records
id UUID PK, animal_id UUID FK NOT NULL, occurred_at TIMESTAMPTZ NOT NULL, outcome VARCHAR(16) NOT NULL, notes TEXT NULL, created_at, updated_at. outcome in complete/partial/unknown.
animal_notes
id UUID PK, animal_id UUID FK NOT NULL, occurred_at TIMESTAMPTZ NOT NULL, title VARCHAR(160) NULL, category VARCHAR(40) NOT NULL, body TEXT NOT NULL, created_at, updated_at, archived_at TIMESTAMPTZ NULL.
tasks
id UUID PK, user_id UUID FK NOT NULL, animal_id UUID FK NULL, title VARCHAR(160) NOT NULL, description TEXT NULL, category VARCHAR(30) NOT NULL, due_at TIMESTAMPTZ NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'open', completed_at TIMESTAMPTZ NULL, reminder_rule_id UUID NULL, created_at, updated_at. Lo stato è open/completed/dismissed.
reminder_rules
id UUID PK, user_id UUID FK NOT NULL, animal_id UUID FK NULL, title VARCHAR(160) NOT NULL, category VARCHAR(30) NOT NULL, interval_days INTEGER NOT NULL CHECK (interval_days > 0), next_due_at TIMESTAMPTZ NOT NULL, is_enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at, updated_at.
notification_preferences
id UUID PK, user_id UUID FK UNIQUE NOT NULL, in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE, push_enabled BOOLEAN NOT NULL DEFAULT FALSE, categories JSONB NOT NULL DEFAULT '{}', quiet_hours_start TIME NULL, quiet_hours_end TIME NULL, created_at, updated_at.
push_subscriptions
id UUID PK, user_id UUID FK NOT NULL, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth_secret TEXT NOT NULL, user_agent TEXT NULL, created_at, last_success_at TIMESTAMPTZ NULL.
notifications
id UUID PK, user_id UUID FK NOT NULL, category VARCHAR(30) NOT NULL, title VARCHAR(160) NOT NULL, body TEXT NOT NULL, target_path TEXT NULL, read_at TIMESTAMPTZ NULL, created_at.
21.3 Tabelle riproduttive
reproduction_cycles
id UUID PK, user_id UUID FK NOT NULL, parent_a_animal_id UUID FK NULL, parent_b_animal_id UUID FK NULL, name VARCHAR(160) NULL, started_on DATE NOT NULL, ended_on DATE NULL, status VARCHAR(16) NOT NULL, notes TEXT NULL, created_at, updated_at.
reproductive_events
id UUID PK, cycle_id UUID FK NOT NULL, event_type VARCHAR(24) NOT NULL, occurred_at TIMESTAMPTZ NOT NULL, animal_id UUID FK NULL, details TEXT NULL, temperature_c NUMERIC(5,2) NULL, humidity_pct NUMERIC(5,2) NULL, created_at, updated_at.
event_type: pairing/observation/ovulation/gravid/laying/live_birth/incubation_start/hatch/loss/other.
clutches
id UUID PK, cycle_id UUID FK NOT NULL, laid_on DATE NOT NULL, egg_count INTEGER NOT NULL CHECK (egg_count >= 0), status VARCHAR(20) NOT NULL, incubator_label VARCHAR(120) NULL, incubation_started_at TIMESTAMPTZ NULL, notes TEXT NULL, created_at, updated_at.
eggs
id UUID PK, clutch_id UUID FK NOT NULL, code VARCHAR(80) NULL, status VARCHAR(20) NOT NULL, notes TEXT NULL, created_at, updated_at. L’identificativo code, quando presente, è univoco all’interno della covata.
incubation_logs
id UUID PK, clutch_id UUID FK NOT NULL, recorded_at TIMESTAMPTZ NOT NULL, temperature_c NUMERIC(5,2) NULL, humidity_pct NUMERIC(5,2) NULL, event_type VARCHAR(24) NOT NULL, notes TEXT NULL, created_at.
offspring_batches
id UUID PK, cycle_id UUID FK NOT NULL, clutch_id UUID FK NULL, born_on DATE NOT NULL, count INTEGER NOT NULL CHECK (count >= 0), notes TEXT NULL, created_at, updated_at.
Le schede di animali possono riferirsi a clutches o offspring_batches come origine. Se l’origine non è nota, i campi restano null.
21.4 Tabelle inventario e documenti
inventory_items
id UUID PK, user_id UUID FK NOT NULL, name VARCHAR(160) NOT NULL, category VARCHAR(32) NOT NULL, unit VARCHAR(24) NOT NULL, quantity_on_hand NUMERIC(12,3) NOT NULL DEFAULT 0, minimum_quantity NUMERIC(12,3) NULL, notes TEXT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at, updated_at.
stock_movements
id UUID PK, item_id UUID FK NOT NULL, movement_type VARCHAR(16) NOT NULL, quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0), unit_cost_cents INTEGER NULL, occurred_at TIMESTAMPTZ NOT NULL, reference VARCHAR(160) NULL, notes TEXT NULL, created_at. La creazione del movimento e l’aggiornamento del saldo avvengono in una singola transazione.
documents
id UUID PK, user_id UUID FK NOT NULL, animal_id UUID FK NULL, cycle_id UUID FK NULL, original_filename VARCHAR(255) NOT NULL, storage_key TEXT UNIQUE NOT NULL, mime_type VARCHAR(120) NOT NULL, size_bytes BIGINT NOT NULL CHECK (size_bytes > 0), category VARCHAR(40) NOT NULL, note TEXT NULL, created_at, deleted_at TIMESTAMPTZ NULL.
21.5 Tabelle condivisione, import/export, genetica e finanze
public_shares
id UUID PK, user_id UUID FK NOT NULL, animal_id UUID FK UNIQUE NOT NULL, slug VARCHAR(100) UNIQUE NOT NULL, is_enabled BOOLEAN NOT NULL DEFAULT FALSE, visible_fields JSONB NOT NULL, public_description TEXT NULL, created_at, updated_at, revoked_at TIMESTAMPTZ NULL. L’API verifica visible_fields contro una allowlist server-side.
import_jobs
id UUID PK, user_id UUID FK NOT NULL, entity_type VARCHAR(40) NOT NULL, storage_key TEXT NOT NULL, status VARCHAR(20) NOT NULL, total_rows INTEGER NOT NULL DEFAULT 0, created_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0, report JSONB NULL, expires_at TIMESTAMPTZ NOT NULL, created_at, updated_at.
export_jobs
id UUID PK, user_id UUID FK NOT NULL, status VARCHAR(20) NOT NULL, storage_key TEXT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at, updated_at.
animal_genetic_traits
id UUID PK, animal_id UUID FK NOT NULL, trait_name VARCHAR(160) NOT NULL, trait_value VARCHAR(240) NOT NULL, source_animal_id UUID FK NULL, confidence_note TEXT NULL, created_at, updated_at.
finance_entries
id UUID PK, user_id UUID FK NOT NULL, animal_id UUID FK NULL, entry_type VARCHAR(12) NOT NULL, occurred_on DATE NOT NULL, amount_cents BIGINT NOT NULL CHECK (amount_cents > 0), currency CHAR(3) NOT NULL DEFAULT 'EUR', category VARCHAR(80) NOT NULL, description VARCHAR(240) NOT NULL, document_id UUID FK NULL, created_at, updated_at. entry_type è income/expense.
subscriptions
id UUID PK, user_id UUID FK UNIQUE NOT NULL, stripe_customer_id VARCHAR(128) UNIQUE NULL, stripe_subscription_id VARCHAR(128) UNIQUE NULL, stripe_price_id VARCHAR(128) NULL, status VARCHAR(32) NOT NULL, current_period_start TIMESTAMPTZ NULL, current_period_end TIMESTAMPTZ NULL, cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE, created_at, updated_at.
stripe_webhook_events
id UUID PK, stripe_event_id VARCHAR(128) UNIQUE NOT NULL, event_type VARCHAR(120) NOT NULL, processed_at TIMESTAMPTZ NULL, result VARCHAR(20) NOT NULL, created_at.
audit_events
id UUID PK, user_id UUID FK NULL, action VARCHAR(80) NOT NULL, entity_type VARCHAR(80) NULL, entity_id UUID NULL, request_id VARCHAR(80) NULL, metadata JSONB NULL, created_at. Non deve contenere password, token di sessione, dati di pagamento o il contenuto privato integrale delle note.
21.6 Indici obbligatori
•	animals(user_id, status), animals(user_id, name), animals(user_id, species), animals(user_id, location_label).
•	feeding_sessions(user_id, performed_at DESC) e feeding_entries(animal_id, session_id).
•	weight_measurements(animal_id, measured_at DESC).
•	shed_records(animal_id, occurred_at DESC).
•	animal_notes(animal_id, occurred_at DESC).
•	tasks(user_id, status, due_at) e reminder_rules(user_id, next_due_at).
•	reproduction_cycles(user_id, status, started_on DESC); reproductive_events(cycle_id, occurred_at); clutches(cycle_id, laid_on); incubation_logs(clutch_id, recorded_at).
•	inventory_items(user_id, is_active); stock_movements(item_id, occurred_at DESC).
•	Tutte le colonne FK; le chiavi esterne a servizi esterni sono uniche.
22. Interfaccia grafica e design system
22.1 Direzione visiva
Vivarqo usa un’identità naturale, pulita e professionale. Evitare un’estetica da gioco, colori fluorescenti, fondi molto saturi e illustrazioni cartoon di rettili.
Palette di riferimento:
•	Verde bosco #23463D: colore primario e navigazione selezionata.
•	Verde salvia #92A99A: colore secondario e superfici di supporto.
•	Avorio #F7F6F0: sfondo principale chiaro.
•	Bianco #FFFFFF: pannelli e campi.
•	Carbone #1E2522: testo principale.
•	Grigio #66716B: testo secondario.
•	Ambra #C98B35: attenzione/scadenza.
•	Rosso #B84A4A: errore o azione distruttiva.
•	Blu #4D7895: informazione neutra.
I colori di stato non sono l’unico indicatore: ogni stato usa anche testo e/o icona, per non affidarsi soltanto al colore.
22.2 Tipografia e componenti
•	Font UI: Inter con fallback sans-serif di sistema.
•	Corpo testo: 16 px su mobile; testo secondario non inferiore a 14 px salvo metadati molto compatti.
•	Titolo pagina: 24–28 px desktop e 22–24 px mobile.
•	Raggio schede: 12 px; campi e pulsanti: 10 px.
•	Spaziatura su griglia di 4 px; margine pagina mobile 16 px.
•	Pulsanti primari con contrasto WCAG AA e area tattile minima 44×44 CSS px.
•	Focus da tastiera visibile; label persistenti sui campi; errori associati ai relativi input.
•	Icone lineari coerenti (Lucide), senza usare icone diverse per la stessa azione.
22.3 Layout responsive
Mobile (fino a 767 px): barra inferiore con Oggi, Animali, Riproduzioni e Altro; azione primaria raggiungibile con il pollice; elenchi a schede compatte; filtri in drawer; modali a schermo quasi pieno per form complessi.
Tablet (768–1023 px): navigazione laterale compatta o drawer persistente; contenuti in una o due colonne secondo il modulo.
Desktop (da 1024 px): sidebar sinistra, barra superiore con ricerca e menu account, contenuto con larghezza massima 1440 px; tabelle usate solo dove facilitano la comparazione di molti record.
22.4 Schermate obbligatorie
1.	Landing page pubblica con spiegazione del prodotto, call to action e link legali.
2.	Registrazione, accesso, recupero password e verifica email.
3.	Oggi.
4.	Elenco animali, ricerca/filtri, creazione e modifica animale.
5.	Dettaglio animale con scheda riepilogativa e tab/segmenti per cronologia, riproduzione, documenti e dati genetici.
6.	Flusso alimentazione singola e multipla.
7.	Inserimento peso, muta e osservazione.
8.	Attività e calendario.
9.	Riproduzioni, ciclo, eventi, covate, uova, incubazione e gruppi di nascita.
10.	Inventario, articolo, saldo e movimenti.
11.	Importazione guidata, anteprima ed errori.
12.	Esportazione dati.
13.	Documenti.
14.	Impostazione QR e anteprima scheda pubblica.
15.	Registro economico e riepiloghi.
16.	Notifiche e preferenze.
17.	Abbonamento, stato pagamento e collegamento al Customer Portal.
18.	Impostazioni account, privacy, esportazione e cancellazione.
22.5 Comportamenti UI obbligatori
Ogni vista dati deve avere stati di caricamento, vuoto, errore e contenuto. Le operazioni distruttive richiedono conferma. Le operazioni di salvataggio mostrano esito positivo/negativo. L’utente non perde un form già compilato per un errore di rete senza messaggio e possibilità di riprovare.
23. PWA e notifiche browser
•	Manifest con nome Vivarqo, short name Vivarqo, icone e colori del tema.
•	Service worker per cache degli asset statici e schermata di avvio.
•	Nessuna cache delle risposte private del backend tramite cache pubblica generica.
•	Nessuna mutazione offline nella prima release.
•	Richiesta permesso notifiche soltanto dopo una scelta esplicita dell’utente; mai al primo caricamento senza contesto.
•	Gestione di aggiornamenti del service worker con avviso quando una nuova versione è pronta.
•	Le pagine pubbliche di condivisione possono essere cacheabili solo secondo regole specifiche e senza dati privati.
24. Sicurezza, privacy e affidabilità
Requisiti minimi:
•	HTTPS obbligatorio in produzione.
•	Helmet e configurazione CSP appropriata.
•	CORS limitato ai domini applicativi.
•	Protezione CSRF sulle API mutative basate su cookie.
•	Rate limiting distribuito o persistente per endpoint sensibili.
•	Query parametrizzate/ORM e validazione di ogni input.
•	Autorizzazione per proprietario verificata a livello di servizio, non solo nascondendo pulsanti nel frontend.
•	Upload privati, dimensione massima configurata, controllo MIME e nomi storage generati dal sistema.
•	Segreti in variabili di ambiente/secret manager; mai commit nel repository.
•	Backup automatici del database e dello storage, con prove periodiche di ripristino.
•	Log senza password, cookie, token, dati carta o contenuto privato non necessario.
•	Esportazione e cancellazione dell’account implementate come flussi controllati e documentati.
•	Informativa privacy, termini e gestione dei diritti dell’utente prima del lancio pubblico.
La politica di conservazione dei log, backup e file cancellati va definita nell’informativa e implementata coerentemente. Una cancellazione dall’interfaccia non deve essere descritta come immediata dai backup se il sistema conserva backup rotazionali per il periodo tecnico stabilito.
25. Test e criteri di accettazione
25.1 Test unitari
Copertura minima obbligatoria per:
•	Validazione dei modelli e dei vincoli numerici.
•	Calcolo dei saldi inventario.
•	Generazione delle occorrenze ricorrenti.
•	Elaborazione idempotente dei webhook Stripe.
•	Validazione e mappatura CSV/XLSX.
•	Costruzione dei campi pubblici consentiti.
25.2 Test integrazione
•	Un account non può leggere né modificare animali, documenti, importazioni o sottoscrizioni di un altro account.
•	La sessione di alimentazione non può contenere animali di proprietari diversi.
•	Il salvataggio multiplo è atomico: o tutti i record della sessione vengono salvati, o nessuno.
•	Il saldo inventario cambia nella stessa transazione del movimento.
•	Un webhook Stripe duplicato non genera modifiche duplicate.
•	Un link pubblico disabilitato non restituisce informazioni.
•	Un campo non incluso nella allowlist pubblica non viene restituito anche se presente nel DB.
•	Il reset password è monouso e scade.
•	Le importazioni non generano record fuori dall’account proprietario.
25.3 Test end-to-end
1.	Registrazione, verifica email e login.
2.	Creazione animale e registrazione di peso/muta.
3.	Alimentazione multipla con risultati differenti.
4.	Creazione task e completamento.
5.	Importazione con errori e successiva conferma.
6.	Creazione ciclo riproduttivo, covata e gruppo di piccoli.
7.	Creazione movimento inventario e verifica del saldo.
8.	Creazione/disabilitazione pagina pubblica.
9.	Esportazione dati.
10.	Checkout in modalità test Stripe, webhook e Customer Portal.
11.	Revoca sessione e cancellazione account.
25.4 Prestazioni
•	Le liste usano paginazione server-side.
•	Le query comuni sono supportate dagli indici indicati.
•	Nessun endpoint restituisce l’intera collezione dell’utente senza limite.
•	Gli upload hanno limiti espliciti di dimensione.
•	Il frontend non scarica la cronologia completa di tutti gli animali per renderizzare la schermata Oggi.
26. Distribuzione e ambienti
Ambienti separati: development, staging, production.
•	Sviluppo locale con Docker Compose per API e PostgreSQL.
•	Database di staging separato dalla produzione e con dati sintetici.
•	Produzione in regione UE, con TLS, database gestito PostgreSQL, storage oggetti in regione UE e backup separati.
•	Migrazioni Prisma eseguite in pipeline controllata prima di avviare la nuova versione dell’API.
•	Deploy automatico su staging dopo il superamento dei test; deploy in produzione con approvazione esplicita.
•	Rollback dell’applicazione documentato. Le migrazioni di schema devono essere progettate per transizioni compatibili quando possibile.
•	File .env esclusi dal controllo versione. Un .env.example contiene solo nomi e valori segnaposto.
26.1 Variabili di ambiente
Nomi previsti: NODE_ENV, PORT, APP_ORIGIN, API_ORIGIN, DATABASE_URL, SESSION_SECRET, CSRF_SECRET, RESEND_API_KEY, EMAIL_FROM, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID, S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, SENTRY_DSN.
Le chiavi reali sono configurate esclusivamente nell’ambiente di esecuzione. Il frontend riceve solo variabili pubbliche, mai chiavi segrete.
28. Elementi commerciali da configurare, non codificare
La specifica tecnica non fissa prezzo mensile, periodo di prova, limiti del piano gratuito, soglia massima di animali, eventuale piano annuale o periodo di tolleranza sui pagamenti. Sono parametri di prodotto da definire prima del lancio commerciale e poi configurare nel backend e in Stripe.
L’app deve poter abilitare/disabilitare funzionalità tramite entitlements lato server, senza distribuire una nuova build frontend a ogni variazione commerciale. Il frontend visualizza le autorizzazioni ricevute dall’API ma non decide autonomamente se un utente è pagante.
29. Riferimenti tecnici ufficiali
•	Frontend: React, Vite e vite-plugin-pwa.
•	Runtime: programma di rilascio Node.js.
•	Database e ORM: documentazione PostgreSQL e Prisma ORM con PostgreSQL.
•	Cache e dati remoti frontend: TanStack Query.
•	Pagamenti: Stripe Billing e Stripe Webhooks.
•	Sicurezza: OWASP Session Management e OWASP Password Storage.
•	Protezione dei dati: GDPR - Regolamento UE 2016/679.
________________________________________
Fine specifica tecnica Vivarqo 1.0.