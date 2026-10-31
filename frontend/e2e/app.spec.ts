import { test, expect } from "@playwright/test";
import { mockApi, signIn, type E2ERecord } from "./fixtures";

test.beforeEach(async ({ page }) => {
  page.e2eState = await mockApi(page.context());
  await page.goto("/");
});

test("accesso: mostra un errore utile e poi apre l'account", async ({ page }) => {
  page.e2eState.failLogin = true;
  await page.getByLabel("Email").fill("allevatore@example.test");
  await page.getByLabel("Password").fill("Password-di-test-123!");
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Credenziali non valide per il test");
  page.e2eState.failLogin = false;
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByText("Allevatore E2E")).toBeVisible();
});

test("registrazione: conferma la creazione dell'account", async ({ page }) => {
  await page.getByRole("button", { name: "Crea un account", exact: true }).click();
  await page.getByLabel("Nome visualizzato").fill("Nuovo allevatore");
  await page.getByLabel("Email").fill("nuovo@example.test");
  await page.getByLabel("Password").fill("Password-nuova-123!");
  await page.getByRole("button", { name: "Crea account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Account creato");
  await expect(page.getByRole("heading", { name: "Accedi a Vivarqo" })).toBeVisible();
});

test("navigazione: URL e stato del browser restano sincronizzati", async ({ page }, testInfo) => {
  await signIn(page);
  if (testInfo.project.name === "mobile-chromium") {
    await page.locator(".mobile-nav").getByRole("button", { name: "Animali" }).click();
    await expect(page).toHaveURL(/\/animals$/);
    await page.locator(".mobile-nav").getByRole("button", { name: "Altro" }).click();
    await page.locator(".more-card").filter({ hasText: "Documenti e QR" }).click();
    await expect(page).toHaveURL(/\/documents$/);
    return;
  }
  await page.locator(".nav-item").filter({ hasText: "Animali" }).click();
  await expect(page).toHaveURL(/\/animals$/);
  await expect(page.locator(".nav-primary .nav-item")).toHaveCount(4);
  await page.locator(".nav-secondary").getByRole("button", { name: "Altro" }).click();
  await page.locator(".more-card").filter({ hasText: "Documenti e QR" }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/animals$/);
  await expect(page.getByRole("heading", { name: "Animali", exact: true }).first()).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.getByRole("heading", { name: "Documenti", exact: true })).toBeVisible();
});

test("animali: crea una scheda e gestisce un modulo lungo su viewport stretti", async ({ page }) => {
  await signIn(page);
  await page.goto("/animals");
  await expect(page.getByRole("heading", { name: "Animali", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Nuovo animale/ }).click();
  const animalForm = page.locator(".embedded-form form").first();
  await animalForm.getByLabel("Nome", { exact: true }).fill("Smeraldo");
  await animalForm.getByLabel("Specie", { exact: true }).fill("Boa constrictor imperator");
  await page.getByLabel("Identificativo", { exact: true }).fill("VRQ-E2E-003");
  await page.getByLabel("Annotazioni genetiche dichiarate").fill("Het dichiarato dall'allevatore");
  await page.getByLabel("La data di nascita è stimata").check();
  await page.getByLabel("Data di acquisizione").fill("2024-01-02");
  await page.getByLabel("Allevatore precedente").fill("Allevamento E2E");
  await page.getByLabel("Provenienza").fill("Nato in cattività presso allevatore precedente");
  await page.getByRole("button", { name: "Salva scheda", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Smeraldo" })).toBeVisible();
  expect(page.e2eState.animals.some(item =>
    item.name === "Smeraldo" &&
    item.geneticsNotes === "Het dichiarato dall'allevatore" &&
    item.birthDateEstimated === true &&
    item.acquiredDate === "2024-01-02" &&
    item.previousBreeder === "Allevamento E2E" &&
    item.originDescription === "Nato in cattività presso allevatore precedente"
  )).toBeTruthy();

  await page.getByRole("button", { name: /Crea in blocco/ }).click();
  await page.getByRole("button", { name: /Riga/ }).click();
  await page.getByRole("button", { name: /Riga/ }).click();
  await expect(page.getByRole("heading", { name: "Crea più animali" })).toBeVisible();
  await expect(page.locator(".table-wrap tbody tr")).toHaveCount(3);
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 2);
});

test("animali: i filtri avanzati e l'ordinamento raggiungono l'API", async ({ page }) => {
  await signIn(page);
  await page.goto("/animals");
  await page.getByText("Filtri avanzati e ordinamento", { exact: true }).click();
  await page.getByLabel("Specie", { exact: true }).fill("Python regius");
  await page.getByLabel("Filtra per sesso", { exact: true }).selectOption("female");
  await page.getByLabel("Morph", { exact: true }).fill("Pastel");
  await page.getByLabel("Posizione / stabulazione", { exact: true }).fill("Rack 2");
  await page.getByLabel("Ordina elenco animali", { exact: true }).selectOption("name");
  await page.getByRole("button", { name: "Applica filtri", exact: true }).click();

  await expect.poll(() => page.e2eState.requests.some(request => {
    if (request.path !== "animals" || request.method !== "GET") return false;
    const query = new URLSearchParams(request.query);
    return query.get("species") === "Python regius" &&
      query.get("sex") === "female" &&
      query.get("morph") === "Pastel" &&
      query.get("location") === "Rack 2" &&
      query.get("sort") === "name";
  })).toBeTruthy();
});

test("registri: aggiunge una pesata, la modifica e chiede conferma prima di eliminarla", async ({ page }) => {
  await signIn(page);
  await page.goto("/care/weights");
  await page.getByRole("button", { name: /Nuova pesata/ }).click();
  await page.getByLabel("Peso (g)").fill("342.5");
  await page.locator(".embedded-form form").getByRole("button", { name: "Salva", exact: true }).click();
  await expect.poll(() => page.e2eState.weights.length).toBe(1);
  await expect(page.getByText("342,5 g")).toBeVisible();
  await expect(page.getByLabel("Andamento del peso")).toBeVisible();

  await page.getByRole("button", { name: "Modifica", exact: true }).click();
  await page.getByLabel("Peso (g)").last().fill("350");
  await page.locator(".embedded-form form").getByRole("button", { name: "Salva modifiche" }).click();
  await expect.poll(() => page.e2eState.weights[0]?.weightG).toBe(350);

  await page.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Eliminare questo registro?");
  await page.getByRole("dialog").getByRole("button", { name: "Annulla", exact: true }).click();
  expect(page.e2eState.requests.some(item => item.method === "DELETE" && item.path.startsWith("weights/"))).toBeFalsy();
  await page.getByRole("button", { name: "Elimina", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Elimina registro" }).click();
  await expect.poll(() => page.e2eState.weights.length).toBe(0);
});

test("offline: le modifiche vengono rifiutate e non accodate localmente", async ({ page }) => {
  await signIn(page);
  await page.goto("/animals");
  await expect(page.getByRole("heading", { name: "Animali", exact: true }).first()).toBeVisible();

  const initialAnimalCount = page.e2eState.animals.length;
  const initialCreateRequests = page.e2eState.requests.filter(item => item.method === "POST" && item.path === "animals").length;
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

  await page.getByRole("button", { name: /Nuovo animale/ }).click();
  const animalForm = page.locator(".embedded-form form").first();
  await animalForm.getByLabel("Nome", { exact: true }).fill("Non salvato offline");
  await animalForm.getByLabel("Specie", { exact: true }).fill("Python regius");
  await page.getByRole("button", { name: "Salva scheda", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Serve una connessione a Internet");
  expect(page.e2eState.animals).toHaveLength(initialAnimalCount);
  expect(page.e2eState.requests.filter(item => item.method === "POST" && item.path === "animals")).toHaveLength(initialCreateRequests);
  await expect(page.getByRole("heading", { name: "Nuova scheda animale" })).toBeVisible();
});

test("registrazioni alimentari: salva una sessione per più animali", async ({ page }) => {
  await signIn(page);
  await page.goto("/feeding");
  await page.getByRole("button", { name: /Nuova sessione/ }).click();
  await page.locator(".feeding-animal-option").filter({ hasText: "Naga" }).locator("input").check();
  await page.locator(".feeding-animal-option").filter({ hasText: "Boreal" }).locator("input").check();
  await page.getByLabel("Tipo alimento").first().fill("Ratto");
  await page.getByLabel("Tipo alimento").nth(1).fill("Topo");
  await page.locator(".embedded-form form").getByRole("button", { name: "Salva", exact: true }).click();
  await expect.poll(() => page.e2eState.sessions.length).toBe(1);
  expect(page.e2eState.sessions[0].entries).toHaveLength(2);
  expect(page.e2eState.sessions[0].entries.map((entry: E2ERecord) => entry.foodType)).toEqual(["Ratto", "Topo"]);
});

test("documenti e QR: carica, modifica, scarica, condivide e revoca", async ({ page }) => {
  await signIn(page);
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documenti", exact: true })).toBeVisible();
  await page.getByLabel("File").setInputFiles({
    name: "scheda-naga.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test fixture")
  });
  await page.getByRole("button", { name: "Carica documento" }).click();
  await expect(page.getByText("scheda-naga.pdf")).toBeVisible();
  expect(page.e2eState.documents).toHaveLength(1);

  const documentRow = page.locator(".table-wrap tbody tr").filter({ hasText: "scheda-naga.pdf" });
  await documentRow.getByRole("button", { name: "Modifica", exact: true }).click();
  const editDialog = page.getByRole("dialog");
  await editDialog.getByLabel("Categoria").selectOption("veterinary");
  await editDialog.getByLabel("Nota (facoltativa)").fill("Aggiornato dal test end-to-end.");
  await editDialog.getByRole("button", { name: "Salva modifiche" }).click();
  await expect.poll(() => page.e2eState.documents[0]?.category).toBe("veterinary");
  await expect.poll(() => page.e2eState.documents[0]?.note).toBe("Aggiornato dal test end-to-end.");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    documentRow.getByRole("button", { name: "Scarica", exact: true }).click()
  ]);
  expect(download.suggestedFilename()).toBe("scheda-naga.pdf");

  await page.getByLabel("Attiva il link pubblico").check();
  await page.getByLabel("Descrizione pubblica (facoltativa)").fill("Profilo pubblico verificato dai test.");
  await page.getByRole("button", { name: "Salva condivisione" }).click();
  await expect(page.getByText("Link attivo")).toBeVisible();
  await expect(page.getByRole("img", { name: "Codice QR del profilo pubblico" })).toBeVisible();
  const publicLink = page.locator(".share-url a");
  await expect(publicLink).toBeVisible();
  const [popup] = await Promise.all([page.context().waitForEvent("page"), publicLink.click()]);
  await expect(popup.getByRole("heading", { name: "Naga", exact: true })).toBeVisible();
  await popup.close();

  await documentRow.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Eliminare il documento?");
  await page.getByRole("dialog").getByRole("button", { name: "Annulla", exact: true }).click();
  await expect(page.getByText("scheda-naga.pdf")).toBeVisible();

  await page.getByRole("button", { name: "Revoca link", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Revocare il link pubblico?");
  await page.getByRole("dialog").getByRole("button", { name: "Revoca link", exact: true }).click();
  await expect(page.getByText("Link disattivato")).toBeVisible();
  expect(page.e2eState.share?.isEnabled).toBe(false);
});

test("riproduzione: crea un ciclo e un evento associato", async ({ page }) => {
  await signIn(page);
  await page.goto("/reproduction");
  await expect(page.locator(".cycle-card").filter({ hasText: "Riproduzione 2026" })).toBeVisible();

  await page.getByRole("button", { name: /Nuovo ciclo/ }).click();
  await page.getByLabel("Nome del ciclo").fill("Ciclo E2E");
  await page.getByLabel("Data inizio").fill("2026-06-01");
  await page.getByLabel("Genitore A").selectOption("animal-1");
  await page.getByLabel("Genitore B").selectOption("animal-2");
  await page.getByRole("button", { name: "Salva ciclo", exact: true }).click();
  await expect.poll(() => page.e2eState.cycles.some(item => item.name === "Ciclo E2E")).toBe(true);
  expect(page.e2eState.requests.some(item => item.path === "reproduction-cycles" && item.method === "POST")).toBeTruthy();

  const eventsTab = page.getByRole("tab", { name: "Eventi e osservazioni" });
  await expect(eventsTab).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /Evento/ }).click();
  await page.getByLabel("Tipo evento").selectOption("pairing");
  await page.getByLabel("Data e ora").fill("2026-06-02T12:00");
  await page.getByLabel("Dettagli").fill("Accoppiamento E2E");
  await page.getByRole("button", { name: "Salva evento", exact: true }).click();

  await expect.poll(() => page.e2eState.events.length).toBe(1);
  expect(page.e2eState.events[0].cycleId).toBeTruthy();
  expect(page.e2eState.requests.some(item => /^reproduction-cycles\/[^/]+\/events$/.test(item.path) && item.method === "POST")).toBeTruthy();
  await expect(page.getByText("Accoppiamento E2E")).toBeVisible();
});

test("riproduzione: traccia uova, controlli d'incubazione e piccoli", async ({ page }) => {
  await signIn(page);
  await page.goto("/reproduction");
  await expect(page.getByRole("heading", { name: "Cicli riproduttivi" })).toBeVisible();
  await page.getByRole("tab", { name: "Covate, uova e incubazione" }).click();
  await page.getByRole("button", { name: /Nuova covata/ }).click();
  await page.getByLabel("Data deposizione").fill("2026-05-10");
  await page.getByLabel("Numero uova").fill("2");
  await page.getByLabel("Incubatrice / posizione").fill("Incubatrice E2E");
  await page.getByRole("button", { name: "Salva covata", exact: true }).click();
  await expect.poll(() => page.e2eState.clutches.length).toBe(2);

  const newClutchCard = page.locator(".clutch-card").filter({ hasText: "Incubatrice E2E" });
  await newClutchCard.getByRole("button", { name: "Modifica", exact: true }).click();
  await page.getByLabel("Incubatrice / posizione").fill("Incubatrice E2E modificata");
  await page.getByRole("button", { name: "Salva covata", exact: true }).click();
  await expect.poll(() => page.e2eState.clutches.find(item => item.incubatorLabel === "Incubatrice E2E modificata")?.incubatorLabel).toBe("Incubatrice E2E modificata");

  await page.getByLabel("Quante uova").fill("2");
  await page.getByLabel("Prefisso codice (facoltativo)").fill("E2E");
  await page.getByRole("button", { name: "Aggiungi uova", exact: true }).click();
  await expect.poll(() => page.e2eState.eggs.length).toBe(2);
  const firstEggCode = page.getByRole("textbox", { name: "Codice uovo E2E-01" });
  await expect(firstEggCode).toBeVisible();
  await firstEggCode.fill("E2E-01-M");
  await firstEggCode.press("Enter");
  await expect.poll(() => page.e2eState.eggs.some(item => item.code === "E2E-01-M")).toBe(true);

  const secondEggRow = page.getByRole("textbox", { name: "Codice uovo E2E-02" }).locator("xpath=ancestor::tr");
  await secondEggRow.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Eliminare l’uovo?");
  await page.getByRole("dialog").getByRole("button", { name: "Annulla", exact: true }).click();
  await expect.poll(() => page.e2eState.eggs.length).toBe(2);
  await secondEggRow.getByRole("button", { name: "Elimina", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Elimina uovo", exact: true }).click();
  await expect.poll(() => page.e2eState.eggs.length).toBe(1);

  await page.getByLabel("Temperatura °C").fill("30.5");
  await page.getByLabel("Umidità %").fill("80");
  await page.getByRole("button", { name: "Registra controllo", exact: true }).click();
  await expect.poll(() => page.e2eState.incubationLogs.length).toBe(1);
  await expect(page.getByText("30,5 °C")).toBeVisible();

  const logRow = page.locator(".log-row").filter({ hasText: "controllo" });
  await logRow.locator("details summary").click();
  await logRow.getByLabel("Temperatura °C").fill("31");
  await logRow.getByLabel("Note", { exact: true }).fill("Controllo aggiornato");
  await logRow.getByRole("button", { name: "Salva controllo", exact: true }).click();
  await expect.poll(() => page.e2eState.incubationLogs[0]?.temperatureC).toBe(31);
  await logRow.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Eliminare il registro di incubazione?");
  await page.getByRole("dialog").getByRole("button", { name: "Annulla", exact: true }).click();
  await expect.poll(() => page.e2eState.incubationLogs.length).toBe(1);
  await logRow.getByRole("button", { name: "Elimina", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Elimina registro", exact: true }).click();
  await expect.poll(() => page.e2eState.incubationLogs.length).toBe(0);

  await page.getByRole("tab", { name: "Piccoli e nascite" }).click();
  const offspringSection = page.locator(".reproduction-detail-section:visible").last();
  const createBatchForm = offspringSection.locator(".embedded-form form").first();
  await createBatchForm.getByLabel("Covata di origine (facoltativa)").selectOption("clutch-2");
  await createBatchForm.getByLabel("Numero di piccoli").fill("2");
  await createBatchForm.getByLabel("Note", { exact: true }).fill("Nascita di prova");
  await createBatchForm.getByRole("button", { name: "Registra lotto", exact: true }).click();
  await expect.poll(() => page.e2eState.batches.length).toBe(1);
  await expect(page.getByText(/2 piccoli/)).toBeVisible();

  const batchRow = page.locator(".log-list .log-row").filter({ hasText: "2 piccoli" });
  await batchRow.locator("details summary").click();
  const batchNotes = batchRow.locator('textarea[name="notes"]');
  await expect(batchNotes).toBeVisible();
  await batchNotes.fill("Nascita modificata");
  await batchRow.getByRole("button", { name: "Salva lotto", exact: true }).click();
  await expect.poll(() => page.e2eState.batches[0]?.notes).toBe("Nascita modificata");

  await createBatchForm.getByLabel("Numero di piccoli").fill("0");
  await createBatchForm.getByLabel("Note", { exact: true }).fill("Lotto da eliminare");
  await createBatchForm.getByRole("button", { name: "Registra lotto", exact: true }).click();
  await expect.poll(() => page.e2eState.batches.length).toBe(2);
  const disposableBatch = page.locator(".log-row").filter({ hasText: "0 piccoli" });
  await disposableBatch.getByRole("button", { name: "Elimina lotto", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Eliminare il registro dei piccoli?");
  await page.getByRole("dialog").getByRole("button", { name: "Elimina registro", exact: true }).click();
  await expect.poll(() => page.e2eState.batches.length).toBe(1);

  await batchRow.getByRole("button", { name: "Crea schede animali", exact: true }).click();
  await page.getByLabel("Prefisso dei nomi").fill("Cucciolo E2E");
  await page.getByLabel("Numero di schede (1–500)").fill("2");
  await page.getByRole("dialog").getByRole("button", { name: "Crea schede" }).click();
  await expect.poll(() => page.e2eState.animals.length).toBe(4);
  expect(page.e2eState.animals.some(item => item.name === "Cucciolo E2E 01")).toBeTruthy();

  await page.getByRole("tab", { name: "Covate, uova e incubazione" }).click();
  const originalClutch = page.locator(".clutch-card").filter({ hasText: "Incubatrice 1" });
  await originalClutch.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Eliminare la covata?");
  await page.getByRole("dialog").getByRole("button", { name: "Annulla", exact: true }).click();
  await expect.poll(() => page.e2eState.clutches.length).toBe(2);
  await originalClutch.getByRole("button", { name: "Elimina", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Elimina covata", exact: true }).click();
  await expect.poll(() => page.e2eState.clutches.length).toBe(1);
});

test("notifiche: salva preferenze, segna le notifiche lette e gestisce dispositivi", async ({ page }) => {
  await signIn(page);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Avvisi e lettura" })).toBeVisible();
  await page.getByLabel("Dalle").fill("22:00");
  await page.getByLabel("Alle", { exact: true }).fill("07:30");
  await page.locator(".preference-switches .preference-row").filter({ hasText: "Notifiche nell'app" }).locator("input").uncheck();
  await page.locator(".category-toggle").filter({ hasText: "Scadenze attività" }).locator("input").uncheck();
  await page.getByRole("button", { name: "Salva preferenze", exact: true }).click();
  await expect.poll(() => page.e2eState.preferences.quietHoursStart).toBe("22:00");
  await expect.poll(() => page.e2eState.preferences.quietHoursEnd).toBe("07:30");
  expect(page.e2eState.preferences.inAppEnabled).toBe(false);
  expect(page.e2eState.preferences.categories.task_due).toBe(false);

  await page.getByRole("button", { name: "Segna tutte come lette" }).click();
  await expect.poll(() => page.e2eState.unreadCount).toBe(0);
  await page.getByRole("button", { name: "Rimuovi", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Rimuovere questo dispositivo?");
  await page.getByRole("dialog").getByRole("button", { name: "Annulla", exact: true }).click();
  expect(page.e2eState.requests.some(item => item.method === "DELETE" && item.path.startsWith("push-subscriptions/"))).toBeFalsy();
  await page.getByRole("button", { name: "Rimuovi", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Rimuovi dispositivo" }).click();
  await expect.poll(() => page.e2eState.devices.length).toBe(0);
});

test("caricamento, errore API e schermata vuota sono stati distinti", async ({ page }) => {
  await signIn(page);
  page.e2eState.animalListDelayMs = 750;
  await page.goto("/animals");
  await expect(page.getByText("Caricamento animali…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Naga" })).toBeVisible();

  page.e2eState.animals = [];
  page.e2eState.animalListDelayMs = 0;
  await page.getByRole("button", { name: /Aggiorna/ }).click();
  await expect(page.getByText("Nessun animale in questa vista")).toBeVisible();

  page.e2eState.failAnimalList = true;
  await page.getByRole("button", { name: /Aggiorna/ }).click();
  await expect(page.getByRole("alert")).toContainText("Errore caricamento animali E2E.");
});

test("documenti e notifiche distinguono caricamento, vuoto ed errore API", async ({ page }) => {
  await signIn(page);
  page.e2eState.documentListDelayMs = 700;
  await page.goto("/documents");
  await expect(page.getByText("Caricamento documenti…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Documenti", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nessun documento", exact: true })).toBeVisible();

  page.e2eState.failDocumentList = true;
  await page.getByRole("button", { name: /Aggiorna/ }).click();
  await expect(page.getByRole("alert")).toContainText("Errore caricamento documenti E2E.");

  page.e2eState.notificationListDelayMs = 700;
  page.e2eState.notifications = [];
  page.e2eState.unreadCount = 0;
  await page.goto("/notifications");
  await expect(page.getByText("Caricamento notifiche…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nessuna notifica", exact: true })).toBeVisible();

  page.e2eState.failNotificationList = true;
  await page.getByRole("button", { name: /Aggiorna/ }).click();
  await expect(page.getByRole("alert")).toContainText("Errore caricamento notifiche E2E.");
});

test("le viste mobile non provocano overflow orizzontale sulle aree operative", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Controllo di viewport previsto sul progetto mobile.");
  await signIn(page);
  for (const path of ["/animals", "/care/weights", "/documents", "/reproduction", "/notifications"]) {
    await page.goto(path);
    await page.locator(".page-wrap").waitFor();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)).toBeTruthy();
  }
});


test("rileva l'inglese del browser e registra l'account con la lingua corretta", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-GB" });
  const state = await mockApi(context);
  const page = await context.newPage();
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Sign in to Vivarqo" })).toBeVisible();

  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByLabel("Display name").fill("English breeder");
  await page.getByLabel("Email").fill("english@example.test");
  await page.getByLabel("Password").fill("Password-english-123!");
  await page.getByRole("button", { name: "Create account", exact: true }).click();

  await expect.poll(() => state.requests.some(request => request.path === "auth/register" && request.body.locale === "en")).toBe(true);
  await context.close();
});
