import { test, expect } from "@playwright/test";
import { mockApi, signIn } from "./fixtures.js";

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
  const group = page.locator(".nav-group").filter({ hasText: "Allevamento" });
  await group.locator("summary").click();
  await group.locator(".nav-item").filter({ hasText: "Documenti e QR" }).click();
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
  await page.getByLabel("Nome", { exact: true }).fill("Smeraldo");
  await page.getByLabel("Specie", { exact: true }).fill("Boa constrictor imperator");
  await page.getByLabel("Identificativo", { exact: true }).fill("VRQ-E2E-003");
  await page.getByRole("button", { name: "Salva scheda", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Smeraldo" })).toBeVisible();
  expect(page.e2eState.animals.some(item => item.name === "Smeraldo")).toBeTruthy();

  await page.getByRole("button", { name: /Crea in blocco/ }).click();
  await page.getByRole("button", { name: /Riga/ }).click();
  await page.getByRole("button", { name: /Riga/ }).click();
  await expect(page.getByRole("heading", { name: "Crea più animali" })).toBeVisible();
  await expect(page.locator(".table-wrap tbody tr")).toHaveCount(3);
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 2);
});

test("registri: aggiunge una pesata, la modifica e chiede conferma prima di eliminarla", async ({ page }) => {
  await signIn(page);
  await page.goto("/care/weights");
  await page.getByRole("button", { name: /Nuovo peso/ }).click();
  await page.getByLabel("Peso in grammi").fill("342.5");
  await page.locator(".embedded-form form").getByRole("button", { name: "Salva", exact: true }).click();
  await expect.poll(() => page.e2eState.weights.length).toBe(1);
  await expect(page.getByText("342.5 g")).toBeVisible();

  await page.getByRole("button", { name: "Modifica", exact: true }).click();
  await page.getByLabel("Peso in grammi").last().fill("350");
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

test("registrazioni alimentari: salva una sessione per più animali", async ({ page }) => {
  await signIn(page);
  await page.goto("/feeding");
  await page.getByRole("button", { name: /Nuovo alimentazione/ }).click();
  await page.locator(".feeding-animal-option").filter({ hasText: "Naga" }).locator("input").check();
  await page.locator(".feeding-animal-option").filter({ hasText: "Boreal" }).locator("input").check();
  await page.getByLabel("Tipo alimento").first().fill("Ratto");
  await page.getByLabel("Tipo alimento").nth(1).fill("Topo");
  await page.locator(".embedded-form form").getByRole("button", { name: "Salva", exact: true }).click();
  await expect.poll(() => page.e2eState.sessions.length).toBe(1);
  expect(page.e2eState.sessions[0].entries).toHaveLength(2);
  expect(page.e2eState.sessions[0].entries.map(entry => entry.foodType)).toEqual(["Ratto", "Topo"]);
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
  expect(page.e2eState.share.isEnabled).toBe(false);
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
  await expect(page.getByText("30.5 °C")).toBeVisible();

  await page.getByRole("tab", { name: "Piccoli e nascite" }).click();
  await page.getByLabel("Numero di piccoli").fill("2");
  await page.getByLabel("Note", { exact: true }).last().fill("Nascita di prova");
  await page.getByRole("button", { name: "Registra lotto", exact: true }).click();
  await expect.poll(() => page.e2eState.batches.length).toBe(1);
  await expect(page.getByText(/2 piccoli/)).toBeVisible();
  await page.getByRole("button", { name: "Crea schede animali" }).click();
  await page.getByLabel("Prefisso dei nomi").fill("Cucciolo E2E");
  await page.getByLabel("Numero di schede (1–500)").fill("2");
  await page.getByRole("dialog").getByRole("button", { name: "Crea schede" }).click();
  await expect.poll(() => page.e2eState.animals.length).toBe(4);
  expect(page.e2eState.animals.some(item => item.name === "Cucciolo E2E 01")).toBeTruthy();
});

test("notifiche: salva preferenze, segna le notifiche lette e gestisce dispositivi", async ({ page }) => {
  await signIn(page);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Avvisi e lettura" })).toBeVisible();
  await page.getByLabel("Dalle").fill("22:00");
  await page.getByLabel("Alle").fill("07:30");
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
