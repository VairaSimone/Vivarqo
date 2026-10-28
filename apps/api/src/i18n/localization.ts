import type { RequestHandler } from "express";

export type Locale = "it" | "en";

type MessagePair = { it: string; en: string };

/**
 * Human-readable API text is localized at the HTTP boundary. API codes, field
 * names, enum values and resource data remain stable for clients/integrations.
 * Store both languages here so existing messages can be translated without
 * rewriting every route or changing the public error-code contract.
 */
const messagePairs: Array<[string, string]> = [
  ["Too many requests", "Troppe richieste"],
  ["Malformed JSON request body", "Il corpo della richiesta JSON non è valido"],
  ["Request body exceeds the permitted size", "Il corpo della richiesta supera la dimensione consentita"],
  ["An unexpected error occurred", "Si è verificato un errore imprevisto"],
  ["Service temporarily unavailable", "Servizio temporaneamente non disponibile"],
  ["Route not found", "Percorso non trovato"],
  ["Request validation failed", "La validazione della richiesta non è riuscita"],
  ["CSRF validation failed", "La verifica CSRF non è riuscita"],
  ["If the address is eligible, an email with further instructions will be sent.", "Se l'indirizzo è idoneo, riceverai un'email con ulteriori istruzioni."],
  ["Email verified. You can now sign in.", "Email verificata. Ora puoi accedere."],
  ["Signed in successfully", "Accesso effettuato correttamente"],
  ["Signed out successfully", "Disconnessione effettuata correttamente"],
  ["All sessions have been revoked", "Tutte le sessioni sono state revocate"],
  ["Password reset successfully. Sign in with your new password.", "Password reimpostata correttamente. Accedi con la nuova password."],
  ["Email change requested. Verify the new address before signing in again.", "Cambio email richiesto. Verifica il nuovo indirizzo prima di accedere nuovamente."],
  ["Password updated. Sign in again with the new password.", "Password aggiornata. Accedi nuovamente con la nuova password."],
  ["Email or password is incorrect", "Email o password non corretti"],
  ["Verify your email before signing in", "Verifica la tua email prima di accedere"],
  ["The token is invalid or has expired", "Il token non è valido o è scaduto"],
  ["Authentication required", "È necessario autenticarsi"],
  ["Current password is required", "È richiesta la password attuale"],
  ["Current password is incorrect", "La password attuale non è corretta"],
  ["Current password is required to change email or password", "Per modificare l'email o la password è richiesta la password attuale"],
  ["An account with this email already exists", "Esiste già un account con questa email"],
  ["At least one account field must be provided", "È necessario fornire almeno un campo dell'account"],
  ["Password contains an unsupported character", "La password contiene un carattere non supportato"],
  ["Invalid token format", "Formato del token non valido"],
  ["Invalid IANA timezone", "Fuso orario IANA non valido"],
  ["Use YYYY-MM-DD", "Usa il formato AAAA-MM-GG"],
  ["Invalid calendar date", "Data di calendario non valida"],
  ["Invalid date", "Data non valida"],
  ["Invalid status filter", "Filtro dello stato non valido"],
  ["Invalid sex filter", "Filtro del sesso non valido"],
  ["Invalid sort option", "Ordinamento non valido"],
  ["Invalid feeding outcome filter", "Filtro dell'esito dell'alimentazione non valido"],
  ["Invalid from date", "Data iniziale non valida"],
  ["Invalid to date", "Data finale non valida"],
  ["End date cannot precede start date", "La data di fine non può precedere la data di inizio"],
  ["Calendar end date cannot precede the start date", "La data finale del calendario non può precedere quella iniziale"],
  ["The animal identifier is already used in this account", "L'identificativo dell'animale è già utilizzato in questo account"],
  ["The request contains repeated animal identifiers", "La richiesta contiene identificativi di animali ripetuti"],
  ["Animal not found", "Animale non trovato"],
  ["One or more animals were not found", "Uno o più animali non sono stati trovati"],
  ["Use the restore action before changing an archived animal status", "Ripristina l'animale prima di modificarne lo stato"],
  ["Only archived animals can be restored", "È possibile ripristinare solo animali archiviati"],
  ["This animal has linked history or records. Archive it instead of deleting it.", "Questo animale ha uno storico o dei registri collegati. Archivialo invece di eliminarlo."],
  ["New care records can only be added to active animals", "È possibile aggiungere nuovi registri di cura solo agli animali attivi"],
  ["Feeding sessions can only contain active animals", "Le sessioni di alimentazione possono includere solo animali attivi"],
  ["Feeding session not found", "Sessione di alimentazione non trovata"],
  ["Feeding entry not found", "Voce di alimentazione non trovata"],
  ["Weight record not found", "Registro del peso non trovato"],
  ["Shed record not found", "Registro della muta non trovato"],
  ["Animal note not found", "Nota dell'animale non trovata"],
  ["Tasks and reminders can only be associated with active animals", "Attività e promemoria possono essere associati solo ad animali attivi"],
  ["Task not found", "Attività non trovata"],
  ["Completed tasks are historical records and cannot be reopened or rescheduled", "Le attività completate sono registrazioni storiche e non possono essere riaperte o riprogrammate"],
  ["Only open tasks can be completed", "È possibile completare solo attività aperte"],
  ["The task has already been completed or dismissed", "L'attività è già stata completata o ignorata"],
  ["Reminder rule not found", "Regola del promemoria non trovata"],
  ["More than one column maps to the same Vivarqo field", "Più colonne corrispondono allo stesso campo di Vivarqo"],
  ["More than one column maps to the same field", "Più colonne corrispondono allo stesso campo"],
  ["The file needs columns for name and species", "Il file deve contenere le colonne nome e specie"],
  ["Import preview could not be read", "Impossibile leggere l'anteprima dell'importazione"],
  ["Upload a CSV or XLSX file as the request body", "Carica un file CSV o XLSX come corpo della richiesta"],
  ["Upload the CSV or XLSX file as the request body", "Carica il file CSV o XLSX come corpo della richiesta"],
  ["Import not found", "Importazione non trovata"],
  ["The import preview is no longer available", "L'anteprima dell'importazione non è più disponibile"],
  ["The import has already been confirmed or expired", "L'importazione è già stata confermata oppure è scaduta"],
  ["Possible name/species duplicates require explicit confirmation", "I possibili duplicati per nome e specie richiedono una conferma esplicita"],
  ["Supported care import types are weights, sheds, notes and feedings", "I tipi di importazione supportati per le cure sono pesi, mute, note e alimentazioni"],
  ["Provide an animalId or animalIdentifier column", "Fornisci una colonna animalId o animalIdentifier"],
  ["Required columns are missing", "Mancano alcune colonne obbligatorie"],
  ["Calendar range is too large", "L'intervallo del calendario è troppo ampio"],
  ["Reproduction cycle not found", "Ciclo riproduttivo non trovato"],
  ["Clutch not found", "Covata non trovata"],
  ["Egg not found", "Uovo non trovato"],
  ["Offspring batch not found", "Lotto di piccoli non trovato"],
  ["Parents must be different animals", "I genitori devono essere animali diversi"],
  ["Egg codes must be unique within the request", "I codici delle uova devono essere univoci nella richiesta"],
  ["Clutch and offspring batch must belong to the same cycle", "La covata e il lotto di piccoli devono appartenere allo stesso ciclo"],
  ["Identifiers must be unique in this request", "Gli identificativi devono essere univoci nella richiesta"],
  ["Invalid inventory id", "ID dell'inventario non valido"],
  ["Quantity exceeds supported precision", "La quantità supera la precisione supportata"],
  ["Inventory item not found", "Articolo di inventario non trovato"],
  ["Archived inventory items cannot receive new movements", "Non è possibile registrare nuovi movimenti per articoli di inventario archiviati"],
  ["The movement would make stock negative", "Il movimento porterebbe la giacenza a un valore negativo"],
  ["Upload the document bytes as the request body", "Carica il contenuto del documento come corpo della richiesta"],
  ["Filename extension does not match detected content", "L'estensione del file non corrisponde al contenuto rilevato"],
  ["Document not found", "Documento non trovato"],
  ["Public share not found", "Condivisione pubblica non trovata"],
  ["Public page not found", "Pagina pubblica non trovata"],
  ["Finance entry not found", "Voce finanziaria non trovata"],
  ["Notification not found", "Notifica non trovata"],
  ["Register a browser push subscription before enabling web push", "Registra una sottoscrizione push del browser prima di attivare le notifiche push"],
  ["Push endpoint must use a supported HTTPS push provider", "L'endpoint push deve usare un provider HTTPS supportato"],
  ["This browser endpoint is already associated with another account", "Questo endpoint del browser è già associato a un altro account"],
  ["Push subscription not found", "Sottoscrizione push non trovata"],
  ["Enable push notifications before sending a test", "Attiva le notifiche push prima di inviare un test"],
  ["Register a browser push subscription before sending a test", "Registra una sottoscrizione push del browser prima di inviare un test"],
  ["Subscription management is not configured", "La gestione degli abbonamenti non è configurata"],
  ["The payment provider is temporarily unavailable", "Il provider di pagamento è temporaneamente non disponibile"],
  ["The payment provider could not complete the request", "Il provider di pagamento non è riuscito a completare la richiesta"],
  ["A subscription price has not been configured", "Non è stato configurato il prezzo di un abbonamento"],
  ["This account already has an active subscription", "Questo account ha già un abbonamento attivo"],
  ["The payment provider returned no checkout URL", "Il provider di pagamento non ha restituito un URL di checkout"],
  ["No billing customer is associated with this account", "Nessun cliente di fatturazione è associato a questo account"],
  ["The payment provider returned no portal URL", "Il provider di pagamento non ha restituito un URL del portale"],
  ["Payment webhook verification is not configured", "La verifica dei webhook di pagamento non è configurata"],
  ["A raw Stripe webhook payload is required", "È richiesto il payload raw del webhook Stripe"],
  ["Stripe webhook signature is invalid", "La firma del webhook Stripe non è valida"],
  ["Stripe webhook payload is invalid JSON", "Il payload del webhook Stripe non è JSON valido"],
  ["Stripe webhook payload is missing required fields", "Nel payload del webhook Stripe mancano campi obbligatori"],
  ["The server is already generating the maximum number of exports", "Il server sta già generando il numero massimo di esportazioni"],
  ["Export not found", "Esportazione non trovata"],
  ["The export is not available or has expired", "L'esportazione non è disponibile oppure è scaduta"],
  ["An animal cannot be its own genetic source", "Un animale non può essere la propria origine genetica"],
  ["Genetic trait not found", "Caratteristica genetica non trovata"],
  ["Invalid value", "Valore non valido"],
  ["Invalid email address", "Indirizzo email non valido"],
  ["Invalid input", "Dato non valido"],
  ["Invalid input: expected string, received undefined", "Dato non valido: è richiesta una stringa"],
  ["Too small: expected string to have >=1 characters", "Il testo deve contenere almeno un carattere"],
  ["Too small: expected string to have >=12 characters", "Il testo deve contenere almeno 12 caratteri"],
  ["Too big: expected string to have <=128 characters", "Il testo non può superare 128 caratteri"],
];

const textTranslations = new Map<string, MessagePair>();
for (const [en, it] of messagePairs) {
  const pair = { en, it };
  textTranslations.set(en, pair);
  textTranslations.set(it, pair);
}

const codeTranslations: Record<string, MessagePair> = {
  RATE_LIMITED: { en: "Too many requests", it: "Troppe richieste" },
  INVALID_JSON: { en: "Malformed JSON request body", it: "Il corpo della richiesta JSON non è valido" },
  PAYLOAD_TOO_LARGE: { en: "Request body exceeds the permitted size", it: "Il corpo della richiesta supera la dimensione consentita" },
  INTERNAL_SERVER_ERROR: { en: "An unexpected error occurred", it: "Si è verificato un errore imprevisto" },
  SERVICE_UNAVAILABLE: { en: "Service temporarily unavailable", it: "Servizio temporaneamente non disponibile" },
  NOT_FOUND: { en: "Route not found", it: "Percorso non trovato" },
  VALIDATION_ERROR: { en: "Request validation failed", it: "La validazione della richiesta non è riuscita" },
  CSRF_VALIDATION_FAILED: { en: "CSRF validation failed", it: "La verifica CSRF non è riuscita" },
  AUTHENTICATION_REQUIRED: { en: "Authentication required", it: "È necessario autenticarsi" },
  INVALID_CREDENTIALS: { en: "Email or password is incorrect", it: "Email o password non corretti" },
  EMAIL_NOT_VERIFIED: { en: "Verify your email before signing in", it: "Verifica la tua email prima di accedere" },
  INVALID_OR_EXPIRED_TOKEN: { en: "The token is invalid or has expired", it: "Il token non è valido o è scaduto" },
  CURRENT_PASSWORD_REQUIRED: { en: "Current password is required", it: "È richiesta la password attuale" },
  EMAIL_IN_USE: { en: "An account with this email already exists", it: "Esiste già un account con questa email" },
  INVALID_ID: { en: "Invalid identifier", it: "Identificativo non valido" },
  ANIMAL_IDENTIFIER_CONFLICT: { en: "The animal identifier is already used in this account", it: "L'identificativo dell'animale è già utilizzato in questo account" },
  ANIMAL_NOT_FOUND: { en: "Animal not found", it: "Animale non trovato" },
  ANIMAL_ARCHIVED: { en: "Use the restore action before changing an archived animal status", it: "Ripristina l'animale prima di modificarne lo stato" },
  ANIMAL_NOT_ARCHIVED: { en: "Only archived animals can be restored", it: "È possibile ripristinare solo animali archiviati" },
  ANIMAL_HAS_HISTORY: { en: "This animal has linked history or records. Archive it instead of deleting it.", it: "Questo animale ha uno storico o dei registri collegati. Archivialo invece di eliminarlo." },
  ANIMAL_NOT_ACTIVE: { en: "New care records can only be added to active animals", it: "È possibile aggiungere nuovi registri di cura solo agli animali attivi" },
  FEEDING_SESSION_NOT_FOUND: { en: "Feeding session not found", it: "Sessione di alimentazione non trovata" },
  FEEDING_ENTRY_NOT_FOUND: { en: "Feeding entry not found", it: "Voce di alimentazione non trovata" },
  WEIGHT_NOT_FOUND: { en: "Weight record not found", it: "Registro del peso non trovato" },
  SHED_NOT_FOUND: { en: "Shed record not found", it: "Registro della muta non trovato" },
  ANIMAL_NOTE_NOT_FOUND: { en: "Animal note not found", it: "Nota dell'animale non trovata" },
  TASK_NOT_FOUND: { en: "Task not found", it: "Attività non trovata" },
  TASK_ALREADY_COMPLETED: { en: "Completed tasks are historical records and cannot be reopened or rescheduled", it: "Le attività completate sono registrazioni storiche e non possono essere riaperte o riprogrammate" },
  TASK_NOT_OPEN: { en: "Only open tasks can be completed", it: "È possibile completare solo attività aperte" },
  REMINDER_RULE_NOT_FOUND: { en: "Reminder rule not found", it: "Regola del promemoria non trovata" },
  IMPORT_HEADER_AMBIGUOUS: { en: "More than one column maps to the same field", it: "Più colonne corrispondono allo stesso campo" },
  IMPORT_REQUIRED_COLUMNS: { en: "Required columns are missing", it: "Mancano alcune colonne obbligatorie" },
  IMPORT_REPORT_INVALID: { en: "Import preview could not be read", it: "Impossibile leggere l'anteprima dell'importazione" },
  IMPORT_FILE_REQUIRED: { en: "Upload the CSV or XLSX file as the request body", it: "Carica il file CSV o XLSX come corpo della richiesta" },
  IMPORT_NOT_FOUND: { en: "Import not found", it: "Importazione non trovata" },
  IMPORT_NOT_CONFIRMABLE: { en: "The import preview is no longer available", it: "L'anteprima dell'importazione non è più disponibile" },
  IMPORT_DUPLICATES_REQUIRE_CONFIRMATION: { en: "Possible name/species duplicates require explicit confirmation", it: "I possibili duplicati per nome e specie richiedono una conferma esplicita" },
  CALENDAR_RANGE_TOO_LARGE: { en: "Calendar range is too large", it: "L'intervallo del calendario è troppo ampio" },
  REPRODUCTION_CYCLE_NOT_FOUND: { en: "Reproduction cycle not found", it: "Ciclo riproduttivo non trovato" },
  CLUTCH_NOT_FOUND: { en: "Clutch not found", it: "Covata non trovata" },
  EGG_NOT_FOUND: { en: "Egg not found", it: "Uovo non trovato" },
  OFFSPRING_BATCH_NOT_FOUND: { en: "Offspring batch not found", it: "Lotto di piccoli non trovato" },
  DUPLICATE_EGG_CODES: { en: "Egg codes must be unique within the request", it: "I codici delle uova devono essere univoci nella richiesta" },
  CLUTCH_CYCLE_MISMATCH: { en: "Clutch and offspring batch must belong to the same cycle", it: "La covata e il lotto di piccoli devono appartenere allo stesso ciclo" },
  DUPLICATE_IDENTIFIERS: { en: "Identifiers must be unique in this request", it: "Gli identificativi devono essere univoci nella richiesta" },
  QUANTITY_OUT_OF_RANGE: { en: "Quantity exceeds supported precision", it: "La quantità supera la precisione supportata" },
  INVENTORY_ITEM_NOT_FOUND: { en: "Inventory item not found", it: "Articolo di inventario non trovato" },
  INVENTORY_ITEM_ARCHIVED: { en: "Archived inventory items cannot receive new movements", it: "Non è possibile registrare nuovi movimenti per articoli di inventario archiviati" },
  INSUFFICIENT_STOCK: { en: "The movement would make stock negative", it: "Il movimento porterebbe la giacenza a un valore negativo" },
  FILE_REQUIRED: { en: "Upload the document bytes as the request body", it: "Carica il contenuto del documento come corpo della richiesta" },
  FILE_EXTENSION_MISMATCH: { en: "Filename extension does not match detected content", it: "L'estensione del file non corrisponde al contenuto rilevato" },
  DOCUMENT_NOT_FOUND: { en: "Document not found", it: "Documento non trovato" },
  PUBLIC_SHARE_NOT_FOUND: { en: "Public share not found", it: "Condivisione pubblica non trovata" },
  PUBLIC_PAGE_NOT_FOUND: { en: "Public page not found", it: "Pagina pubblica non trovata" },
  FINANCE_ENTRY_NOT_FOUND: { en: "Finance entry not found", it: "Voce finanziaria non trovata" },
  NOTIFICATION_NOT_FOUND: { en: "Notification not found", it: "Notifica non trovata" },
  PUSH_SUBSCRIPTION_REQUIRED: { en: "Register a browser push subscription before enabling web push", it: "Registra una sottoscrizione push del browser prima di attivare le notifiche push" },
  INVALID_PUSH_ENDPOINT: { en: "Push endpoint must use a supported HTTPS push provider", it: "L'endpoint push deve usare un provider HTTPS supportato" },
  PUSH_ENDPOINT_ALREADY_REGISTERED: { en: "This browser endpoint is already associated with another account", it: "Questo endpoint del browser è già associato a un altro account" },
  PUSH_SUBSCRIPTION_NOT_FOUND: { en: "Push subscription not found", it: "Sottoscrizione push non trovata" },
  PUSH_NOT_ENABLED: { en: "Enable push notifications before sending a test", it: "Attiva le notifiche push prima di inviare un test" },
  BILLING_NOT_CONFIGURED: { en: "Subscription management is not configured", it: "La gestione degli abbonamenti non è configurata" },
  BILLING_PROVIDER_UNAVAILABLE: { en: "The payment provider is temporarily unavailable", it: "Il provider di pagamento è temporaneamente non disponibile" },
  BILLING_PROVIDER_ERROR: { en: "The payment provider could not complete the request", it: "Il provider di pagamento non è riuscito a completare la richiesta" },
  SUBSCRIPTION_ALREADY_ACTIVE: { en: "This account already has an active subscription", it: "Questo account ha già un abbonamento attivo" },
  BILLING_CUSTOMER_MISSING: { en: "No billing customer is associated with this account", it: "Nessun cliente di fatturazione è associato a questo account" },
  BILLING_WEBHOOK_NOT_CONFIGURED: { en: "Payment webhook verification is not configured", it: "La verifica dei webhook di pagamento non è configurata" },
  WEBHOOK_BODY_REQUIRED: { en: "A raw Stripe webhook payload is required", it: "È richiesto il payload raw del webhook Stripe" },
  WEBHOOK_SIGNATURE_INVALID: { en: "Stripe webhook signature is invalid", it: "La firma del webhook Stripe non è valida" },
  WEBHOOK_BODY_INVALID: { en: "Stripe webhook payload is invalid JSON", it: "Il payload del webhook Stripe non è JSON valido" },
  EXPORT_CAPACITY_EXCEEDED: { en: "The server is already generating the maximum number of exports", it: "Il server sta già generando il numero massimo di esportazioni" },
  EXPORT_NOT_FOUND: { en: "Export not found", it: "Esportazione non trovata" },
  EXPORT_EXPIRED: { en: "The export is not available or has expired", it: "L'esportazione non è disponibile oppure è scaduta" },
  GENETIC_SOURCE_SELF_REFERENCE: { en: "An animal cannot be its own genetic source", it: "Un animale non può essere la propria origine genetica" },
  GENETIC_TRAIT_NOT_FOUND: { en: "Genetic trait not found", it: "Caratteristica genetica non trovata" },
};

export function normalizeLocale(value: unknown): Locale | undefined {
  return value === "it" || value === "en" ? value : undefined;
}

export function getPreferredLocale(acceptLanguage?: string | null): Locale {
  if (!acceptLanguage) return "it";
  const candidates = acceptLanguage.split(",").map((value, index) => {
    const parts = value.trim().split(";q=");
    const language = (parts[0] ?? "").trim().toLowerCase();
    const quality = parts.length > 1 ? Number(parts[1]) : 1;
    return { language, quality: Number.isFinite(quality) ? quality : 0, index };
  }).filter((value) => value.quality > 0).sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const candidate of candidates) {
    if (candidate.language === "it" || candidate.language.startsWith("it-")) return "it";
    if (candidate.language === "en" || candidate.language.startsWith("en-")) return "en";
  }
  return "it";
}

export function resolveLocale(options: {
  responseLocale?: unknown;
  accountLocale?: unknown;
  acceptLanguage?: string | null;
}): Locale {
  return normalizeLocale(options.responseLocale)
    ?? normalizeLocale(options.accountLocale)
    ?? getPreferredLocale(options.acceptLanguage);
}

export function localizeMessage(message: string, locale: Locale, code?: string): string {
  const exact = textTranslations.get(message);
  if (exact) return exact[locale];
  const byCode = code ? codeTranslations[code] : undefined;
  if (byCode) return byCode[locale];
  if (/^Invalid .+/.test(message) && locale === "it") return "Dato non valido";
  return message;
}

export function localizeValidationMessage(message: string, locale: Locale): string {
  const translated = localizeMessage(message, locale);
  return translated === message && !textTranslations.has(message)
    ? (locale === "it" ? "Valore non valido." : "Invalid value.")
    : translated;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function localizeResponseBody(body: unknown, locale: Locale): unknown {
  if (!isRecord(body)) return body;
  const output: Record<string, unknown> = { ...body };
  const code = typeof body.code === "string" ? body.code : undefined;

  if (typeof body.message === "string") {
    output.message = localizeMessage(body.message, locale, code);
  }

  if (isRecord(body.details) && Array.isArray(body.details.issues)) {
    output.details = {
      ...body.details,
      issues: body.details.issues.map((entry) => {
        if (!isRecord(entry) || typeof entry.message !== "string") return entry;
        return { ...entry, message: localizeValidationMessage(entry.message, locale) };
      }),
    };
  }
  return output;
}

/**
 * Account settings win over the browser preference. responseLocale lets an
 * account update or successful login apply the selected locale immediately,
 * before the next request reloads the account context from the database.
 */
export const localizationMiddleware: RequestHandler = (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    const auth = res.locals.auth as { locale?: unknown } | undefined;
    const locale = resolveLocale({
      responseLocale: res.locals.responseLocale,
      accountLocale: auth?.locale,
      acceptLanguage: req.get("accept-language"),
    });
    return originalJson(body === undefined ? undefined : localizeResponseBody(body, locale));
  }) as typeof res.json;
  next();
};
