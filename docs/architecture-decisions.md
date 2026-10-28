# Decisioni e discrepanze rilevate — Vivarqo 1.0

## Decisioni di questo incremento
- Il repository segue il monorepo pnpm previsto dalla specifica.
- Il backend usa Node.js 24 LTS, TypeScript, Express 5, Zod, Pino e Prisma ORM 7 con adapter PostgreSQL.
- La migrazione iniziale riproduce lo SQL ricevuto senza riscrivere vincoli, indici, funzioni o trigger.
- `GET /healthz` misura la liveness; `GET /readyz` verifica PostgreSQL. Gli endpoint di dominio restano non implementati in questo incremento.
- Check constraint e funzioni/trigger PostgreSQL restano nella migrazione SQL: Prisma Schema Language non esprime tutti questi costrutti. Non usare `prisma db push`.
- La migrazione non è stata eseguita contro un DB reale in questo ambiente.

## Discrepanze o decisioni necessarie
1. **Preferenze account non completamente persistite.** La sezione 6.3 afferma che l'account conserva unità di misura e preferenze di visualizzazione. La tabella `users` contiene lingua e fuso orario e `notification_preferences` contiene preferenze di notifica, ma non vedo colonne/tabelle per unità e preferenze di visualizzazione. Non aggiungo campi senza una revisione esplicita dello schema.
2. **Nome personalizzato della condivisione pubblica.** La sezione 14.2 cita un “nome scelto per la condivisione”, ma `public_shares` ha `visible_fields` e `public_description`, non un campo dedicato. Non deduco se riutilizzare `animals.name` oppure aggiungere una colonna.
3. **Autore degli eventi riproduttivi.** La sezione 12.2 menziona l'autore dell'evento, ma `reproductive_events` non ha una colonna autore/`user_id`. Il proprietario del ciclo potrebbe bastare nel modello single-user, ma la specifica non lo dichiara esplicitamente come sostituto.
4. **Domini di alcuni campi status non definiti.** `account_status`, `clutches.status`, `eggs.status`, `import_jobs.status` ed `export_jobs.status` sono stringhe senza CHECK nel SQL. La specifica non elenca i valori ammessi per tutti questi campi. Non inventare cataloghi prima di implementare i relativi moduli.
5. **Semantica di `stock_movements.adjustment`.** La quantità è positiva e il tipo distingue `in`, `out`, `adjustment`, ma non è chiarito se adjustment sia una variazione o un'impostazione del saldo assoluto. Non implementare il saldo finché la semantica non è formalizzata.
6. **Prerequisiti della migrazione.** PostgreSQL 18, database vuoto, estensione `citext` e permessi sufficienti per crearla. Non rilanciare su uno schema già popolato.
