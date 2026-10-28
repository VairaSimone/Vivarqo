# Decisioni e discrepanze rilevate — Vivarqo 1.0

## Decisioni di questo incremento
- Il repository segue il monorepo pnpm previsto dalla specifica.
- Il backend usa Node.js 24 LTS, TypeScript, Express 5, Zod, Pino e Prisma ORM 7 con adapter PostgreSQL.
- La migrazione iniziale riproduce lo SQL ricevuto senza riscrivere vincoli, indici, funzioni o trigger.
- `GET /healthz` misura la liveness; `GET /readyz` verifica PostgreSQL. Gli endpoint di dominio restano non implementati in questo incremento.
- Check constraint e funzioni/trigger PostgreSQL restano nella migrazione SQL: Prisma Schema Language non esprime tutti questi costrutti. Non usare `prisma db push`.
- La migrazione non è stata eseguita contro un DB reale in questo ambiente.

## Incremento 2 — Account e autenticazione

- Le password vengono memorizzate con Argon2id (memoryCost=19456, timeCost=2, parallelism=1); password e token non sono mai registrati nei log.
- I token di verifica e reset sono casuali, ne viene persistito soltanto SHA-256, sono monouso e hanno scadenza rispettivamente di 24 ore e 60 minuti.
- Gli account devono verificare l'email prima del login. Le risposte di register/resend/forgot sono generiche per non consentire l'enumerazione degli indirizzi.
- Le sessioni usano token casuali opachi da 256 bit; solo l'hash è scritto in user_sessions. Cookie HttpOnly, SameSite=Lax e Secure in produzione. Sessione con scadenza idle di 30 giorni, rinnovo quando resta meno di 7 giorni e limite assoluto di 90 giorni.
- Le operazioni mutative sotto /api/v1 richiedono un token CSRF HMAC-firmato con nonce e timestamp, inviato sia nel cookie leggibile CSRF sia nell'header X-CSRF-Token. Le richieste con Origin devono corrispondere a APP_ORIGIN. Il futuro webhook Stripe è escluso dal CSRF perché dovrà usare la verifica della firma Stripe.
- POST /api/v1/auth/sessions/revoke-all è una rotta aggiuntiva per il requisito di revoca di tutte le sessioni; il catalogo iniziale della specifica non indicava un endpoint esplicito per questa azione.
- Resend è l'adapter email predefinito; i test iniettano un sender fittizio. Se Resend non è configurato o fallisce, il sistema non espone il token o la risposta del provider e registra solo un messaggio di log senza dati personali.
- Il cambio email richiede la password corrente, azzera email_verified_at, revoca le sessioni e richiede la verifica del nuovo indirizzo. Il cambio password richiede la password corrente e revoca tutte le sessioni.
- CSRF_SECRET è obbligatorio e deve avere almeno 32 caratteri. SESSION_SECRET non è necessario perché i token sessione sono casuali e non firmati: il database conserva il loro hash.

## Discrepanze o decisioni necessarie
1. **Preferenze account non completamente persistite.** La sezione 6.3 afferma che l'account conserva unità di misura e preferenze di visualizzazione. La tabella `users` contiene lingua e fuso orario e `notification_preferences` contiene preferenze di notifica, ma non vedo colonne/tabelle per unità e preferenze di visualizzazione. Non aggiungo campi senza una revisione esplicita dello schema.
2. **Nome personalizzato della condivisione pubblica.** La sezione 14.2 cita un “nome scelto per la condivisione”, ma `public_shares` ha `visible_fields` e `public_description`, non un campo dedicato. Non deduco se riutilizzare `animals.name` oppure aggiungere una colonna.
3. **Autore degli eventi riproduttivi.** La sezione 12.2 menziona l'autore dell'evento, ma `reproductive_events` non ha una colonna autore/`user_id`. Il proprietario del ciclo potrebbe bastare nel modello single-user, ma la specifica non lo dichiara esplicitamente come sostituto.
4. **Domini di alcuni campi status non definiti.** `account_status`, `clutches.status`, `eggs.status`, `import_jobs.status` ed `export_jobs.status` sono stringhe senza CHECK nel SQL. La specifica non elenca i valori ammessi per tutti questi campi. Non inventare cataloghi prima di implementare i relativi moduli.
5. **Semantica di `stock_movements.adjustment`.** La quantità è positiva e il tipo distingue `in`, `out`, `adjustment`, ma non è chiarito se adjustment sia una variazione o un'impostazione del saldo assoluto. Non implementare il saldo finché la semantica non è formalizzata.
6. **Prerequisiti della migrazione.** PostgreSQL 18, database vuoto, estensione `citext` e permessi sufficienti per crearla. Non rilanciare su uno schema già popolato.

## Incremento 5 — Moduli di dominio rimanenti

- I cicli riproduttivi, eventi, covate, uova, log d'incubazione e gruppi di nascita sono filtrati attraverso il proprietario del ciclo. Gli eventi non dispongono di una colonna autore dedicata nello schema dato; le mutazioni di rilievo producono un audit event per l'utente che le esegue.
- La gestione documenti accetta PDF/JPEG/PNG/WebP fino a 10 MB, controlla magic bytes e MIME, genera chiavi casuali e non usa mai il nome originale come percorso. Download sempre autenticato. In sviluppo/test i file privati risiedono in PRIVATE_STORAGE_PATH; in produzione l'API richiede una configurazione persistente e privata, preferibilmente storage S3 in regione UE.
- Le pagine condivise hanno slug casuali, sono disattivate finché non abilitate e restituiscono soltanto i campi nella allowlist. `animals.name` è il nome pubblicato se selezionato; la tabella iniziale non contiene un nome alternativo per la condivisione.
- L'export produce ZIP privati CSV/ZIP con ID stabili, dati relazionali e documenti solo su richiesta; il link autenticato scade dopo 24 ore. L'importazione CSV/XLSX supporta anagrafiche animali e registri strutturati di pesi, mute, note e alimentazioni; importazioni riproduttive e di altre entità richiedono template dedicati.
- Le quantità `in` e `out` sono variazioni positive; `adjustment.quantity` rappresenta il nuovo saldo fisico contato, non una variazione. Il movimento e il saldo sono salvati in transazione con lock della riga. Questa decisione evita di violare il vincolo SQL che richiede quantità di movimento positive.
- L'integrazione Stripe usa le API REST HTTPS, richiede STRIPE_SECRET_KEY, STRIPE_PRICE_ID e STRIPE_WEBHOOK_SECRET; i webhook verificano la firma e memorizzano l'ID evento per l'idempotenza. La CI non possiede credenziali Stripe e non esegue acquisti reali.
- Le notifiche in-app sono persistite e leggibili, con preferenze, finestre quiet hours e registrazione delle sottoscrizioni push. L'invio effettivo delle notifiche push via VAPID non è attivo in questo incremento, per cui non viene dichiarata una consegna push.
