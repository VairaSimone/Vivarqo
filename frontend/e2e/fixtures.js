import { expect } from "@playwright/test";

const makeAnimal = (overrides = {}) => ({
  id: "animal-1", name: "Naga", species: "Python regius", sex: "female", morph: "Pastel",
  status: "active", identifier: "VRQ-001", birthDate: "2022-05-12T00:00:00.000Z",
  locationLabel: "Rack 2", notes: "", ...overrides
});
const pagination = items => ({ page: 1, pageSize: 50, total: items.length, totalPages: 1 });

export async function mockApi(context) {
  const animal = makeAnimal();
  const secondAnimal = makeAnimal({ id: "animal-2", name: "Boreal", species: "Boa constrictor", sex: "male", morph: "Normal", identifier: "VRQ-002" });
  const cycle = {
    id: "cycle-1", name: "Riproduzione 2026", startedOn: "2026-01-01T00:00:00.000Z", endedOn: null,
    status: "active", parentAAnimalId: animal.id, parentBAnimalId: secondAnimal.id,
    parentA: animal, parentB: secondAnimal, _count: { clutches: 1, events: 0, offspringBatches: 0 }
  };
  const clutch = {
    id: "clutch-1", cycleId: cycle.id, laidOn: "2026-07-01T00:00:00.000Z", eggCount: 3,
    status: "incubating", incubatorLabel: "Incubatrice 1", incubationStartedAt: "2026-07-01T00:00:00.000Z",
    notes: "", _count: { eggs: 0, incubationLogs: 0 }
  };
  const state = {
    authenticated: false, failLogin: false, failAnimalList: false, failDocumentList: false, failNotificationList: false, animalListDelayMs: 0, documentListDelayMs: 0, notificationListDelayMs: 0,
    animals: [animal, secondAnimal], cycle, cycles: [cycle], clutches: [clutch], eggs: [],
    events: [], incubationLogs: [], batches: [], weights: [], sheds: [], notes: [], sessions: [], documents: [],
    share: null,
    notifications: [{ id: "notice-1", title: "Attività in scadenza", body: "Controlla la scheda di Naga.", category: "task_due", createdAt: "2026-10-28T10:00:00.000Z", readAt: null, targetPath: "/animals/animal-1" }],
    unreadCount: 1,
    preferences: { inAppEnabled: true, pushEnabled: false, categories: { task_due: true, system: true }, quietHoursStart: "", quietHoursEnd: "" },
    devices: [{ id: "device-1", userAgent: "Chromium E2E", createdAt: "2026-10-28T10:00:00.000Z" }],
    requests: [], nextId: 1
  };
  const nextId = prefix => {
    const collections = {
      animal: state.animals, cycle: state.cycles, clutch: state.clutches, egg: state.eggs,
      log: state.incubationLogs, batch: state.batches, doc: state.documents,
      device: state.devices, session: state.sessions
    };
    const existing = collections[prefix] || [];
    let id;
    do { id = prefix + "-" + String(state.nextId++); } while (existing.some(item => item.id === id));
    return id;
  };
  const itemsResponse = (key, items) => ({ [key]: items, pagination: pagination(items) });

  await context.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1\//, "").replace(/\/$/, "");
    const method = request.method().toUpperCase();
    const headers = request.headers();
    let body = {};
    if (headers["content-type"]?.includes("application/json")) {
      try { body = request.postDataJSON() || {}; } catch { body = {}; }
    }
    state.requests.push({ path, method, body });
    const respond = (payload = {}, status = 200) => route.fulfill({
      status, contentType: "application/json; charset=utf-8", body: JSON.stringify(payload)
    });

    if (path === "auth/csrf" && method === "GET") return respond({ csrfToken: "e2e-csrf-token" });
    if (path === "auth/me" && method === "GET") {
      return state.authenticated
        ? respond({ user: { id: "user-1", email: "allevatore@example.test", displayName: "Allevatore E2E", locale: "it", timezone: "Europe/Rome" } })
        : respond({ message: "Sessione non valida." }, 401);
    }
    if (path === "auth/login" && method === "POST") {
      if (state.failLogin) return respond({ message: "Credenziali non valide per il test." }, 401);
      state.authenticated = true;
      return respond({ message: "Accesso eseguito." });
    }
    if (path === "auth/logout" && method === "POST") { state.authenticated = false; return respond({}); }
    if (path.startsWith("auth/") && method === "POST") return respond({ message: "Richiesta accettata." });
    if (path === "account" && method === "PATCH") return respond({ message: "Impostazioni aggiornate." });
    if (path === "home/today" && method === "GET") return respond({ tasks: { dueToday: [], overdue: [] }, counts: { dueToday: 0, overdue: 0 }, recentEvents: [] });
    if (path.startsWith("billing/") && method === "GET") return respond({ subscription: { status: "active", plan: "BREEDER" } });

    if (path === "animals" && method === "GET") {
      if (state.animalListDelayMs) await new Promise(resolve => setTimeout(resolve, state.animalListDelayMs));
      if (state.failAnimalList) return respond({ message: "Errore caricamento animali E2E." }, 503);
      const statusFilter = url.searchParams.get("status");
      const list = statusFilter && statusFilter !== "all"
        ? state.animals.filter(item => item.status === statusFilter || (statusFilter === "active" && !item.status))
        : state.animals;
      return respond({ animals: list, pagination: { ...pagination(list), page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 50) } });
    }
    if (path === "animals" && method === "POST") {
      const created = makeAnimal({ ...body, id: nextId("animal"), status: body.status || "active" });
      state.animals.push(created);
      return respond({ animal: created });
    }
    if (path === "animals/bulk" && method === "POST") {
      const created = (body.animals || []).map(item => makeAnimal({ ...item, id: nextId("animal") }));
      state.animals.push(...created);
      return respond({ animals: created, createdCount: created.length });
    }

    const animalShare = path.match(/^animals\/([^/]+)\/public-share$/);
    if (animalShare && method === "GET") return state.share?.animalId === animalShare[1] ? respond({ share: state.share }) : respond({ message: "Condivisione assente." }, 404);
    if (animalShare && method === "POST") {
      state.share = { id: "share-1", animalId: animalShare[1], slug: "naga-e2e", url: null, visibleFields: body.visibleFields || ["name", "species", "morph"], publicDescription: body.publicDescription || null, isEnabled: body.isEnabled === true, revokedAt: null };
      return respond({ share: state.share });
    }
    const publicShare = path.match(/^public-shares\/([^/]+)$/);
    if (publicShare && method === "PATCH") {
      state.share = body.revoke ? { ...state.share, isEnabled: false, revokedAt: new Date().toISOString() } : { ...state.share, ...body, revokedAt: null };
      return respond({ share: state.share });
    }
    const animalDetail = path.match(/^animals\/([^/]+)$/);
    if (animalDetail && method === "GET") {
      const found = state.animals.find(item => item.id === animalDetail[1]);
      return found ? respond({ animal: found }) : respond({ message: "Animale non trovato." }, 404);
    }
    if (animalDetail && method === "PATCH") {
      const index = state.animals.findIndex(item => item.id === animalDetail[1]);
      if (index >= 0) state.animals[index] = { ...state.animals[index], ...body };
      return respond({ animal: state.animals[index] || body });
    }
    if (animalDetail && method === "DELETE") { state.animals = state.animals.filter(item => item.id !== animalDetail[1]); return respond({}); }
    if (animalDetail && method === "POST") return respond({});
    const animalRegistry = path.match(/^animals\/([^/]+)\/(weights|sheds|notes|genetic-traits)$/);
    if (animalRegistry) {
      const [, animalId, kind] = animalRegistry;
      const collection = kind === "weights" ? state.weights : kind === "sheds" ? state.sheds : kind === "notes" ? state.notes : [];
      const key = kind === "weights" ? "weights" : kind === "sheds" ? "sheds" : kind === "notes" ? "notes" : "traits";
      if (method === "GET") return respond(itemsResponse(key, collection.filter(item => item.animalId === animalId)));
      if (method === "POST") {
        const created = { id: nextId(kind), animalId, ...body };
        collection.push(created);
        return respond({ [kind === "weights" ? "weight" : kind === "sheds" ? "shed" : kind === "notes" ? "note" : "trait"]: created });
      }
    }
    const individualRecord = path.match(/^(weights|sheds|animal-notes|genetic-traits)\/([^/]+)$/);
    if (individualRecord && ["PATCH", "DELETE"].includes(method)) {
      const [, kind, id] = individualRecord;
      const collection = kind === "weights" ? state.weights : kind === "sheds" ? state.sheds : kind === "animal-notes" ? state.notes : [];
      const index = collection.findIndex(item => item.id === id);
      if (method === "PATCH" && index >= 0) collection[index] = { ...collection[index], ...body };
      if (method === "DELETE" && index >= 0) collection.splice(index, 1);
      return respond({});
    }

    if (path === "feeding-sessions" && method === "GET") return respond(itemsResponse("sessions", state.sessions));
    if (path === "feeding-sessions" && method === "POST") {
      const session = { id: nextId("session"), performedAt: body.performedAt, notes: body.notes, entries: (body.entries || []).map(entry => ({ id: nextId("entry"), ...entry, animal: state.animals.find(a => a.id === entry.animalId) })) };
      state.sessions.push(session);
      return respond({ session });
    }
    const session = path.match(/^feeding-sessions\/([^/]+)$/);
    if (session && method === "GET") return respond({ session: state.sessions.find(item => item.id === session[1]) || null });
    const feedingEntry = path.match(/^feeding-entries\/([^/]+)$/);
    if (feedingEntry && ["PATCH", "DELETE"].includes(method)) {
      for (const item of state.sessions) {
        const index = item.entries.findIndex(entry => entry.id === feedingEntry[1]);
        if (index >= 0 && method === "PATCH") item.entries[index] = { ...item.entries[index], ...body };
        if (index >= 0 && method === "DELETE") item.entries.splice(index, 1);
      }
      return respond({});
    }

    if (path === "reproduction-cycles" && method === "GET") return respond(itemsResponse("cycles", state.cycles));
    const cycleEvents = path.match(/^reproduction-cycles\/([^/]+)\/events$/);
    if (cycleEvents && method === "GET") {
      const list = state.events.filter(item => item.cycleId === cycleEvents[1]);
      return respond(itemsResponse("events", list));
    }
    if (cycleEvents && method === "POST") {
      const created = { id: nextId("event"), cycleId: cycleEvents[1], ...body };
      state.events.push(created);
      return respond({ event: created });
    }
    const cycleClutches = path.match(/^reproduction-cycles\/([^/]+)\/clutches$/);
    if (cycleClutches && method === "GET") return respond(itemsResponse("clutches", state.clutches.filter(item => item.cycleId === cycleClutches[1])));
    const cycleDetail = path.match(/^reproduction-cycles\/([^/]+)$/);
    if (cycleDetail && method === "GET") return respond({ cycle: state.cycles.find(item => item.id === cycleDetail[1]) || state.cycle });
    if (cycleDetail && ["PATCH", "DELETE"].includes(method)) {
      if (method === "DELETE") state.cycles = state.cycles.filter(item => item.id !== cycleDetail[1]);
      else state.cycles = state.cycles.map(item => item.id === cycleDetail[1] ? { ...item, ...body } : item);
      return respond({ cycle: state.cycles.find(item => item.id === cycleDetail[1]) || null });
    }
    if (path === "reproduction-cycles" && method === "POST") {
      state.cycle = { id: nextId("cycle"), status: "planned", ...body };
      state.cycles.push(state.cycle);
      return respond({ cycle: state.cycle });
    }
    const reproductiveEvent = path.match(/^reproductive-events\/([^/]+)$/);
    if (reproductiveEvent && ["PATCH", "DELETE"].includes(method)) {
      const index = state.events.findIndex(item => item.id === reproductiveEvent[1]);
      if (method === "PATCH" && index >= 0) state.events[index] = { ...state.events[index], ...body };
      if (method === "DELETE" && index >= 0) state.events.splice(index, 1);
      return respond({});
    }
    if (path === "clutches" && method === "POST") {
      const created = { id: nextId("clutch"), cycleId: body.cycleId, eggCount: Number(body.eggCount), status: body.status, laidOn: body.laidOn, incubatorLabel: body.incubatorLabel, incubationStartedAt: body.incubationStartedAt, notes: body.notes, _count: { eggs: 0, incubationLogs: 0 } };
      state.clutches.push(created);
      return respond({ clutch: created });
    }
    const clutchDetail = path.match(/^clutches\/([^/]+)$/);
    if (clutchDetail && method === "GET") return respond({ clutch: state.clutches.find(item => item.id === clutchDetail[1]) || null });
    if (clutchDetail && method === "PATCH") {
      const index = state.clutches.findIndex(item => item.id === clutchDetail[1]);
      if (index >= 0) state.clutches[index] = { ...state.clutches[index], ...body };
      return respond({ clutch: state.clutches[index] || null });
    }
    if (clutchDetail && method === "DELETE") {
      state.clutches = state.clutches.filter(item => item.id !== clutchDetail[1]);
      state.eggs = state.eggs.filter(item => item.clutchId !== clutchDetail[1]);
      return respond({});
    }
    const clutchEggs = path.match(/^clutches\/([^/]+)\/eggs$/);
    if (clutchEggs && method === "GET") return respond(itemsResponse("eggs", state.eggs.filter(item => item.clutchId === clutchEggs[1])));
    if (clutchEggs && method === "POST") {
      const created = (body.eggs || []).map(item => ({ id: nextId("egg"), clutchId: clutchEggs[1], ...item }));
      state.eggs.push(...created);
      const current = state.clutches.find(item => item.id === clutchEggs[1]);
      if (current) current._count.eggs = state.eggs.filter(item => item.clutchId === current.id).length;
      return respond({ eggs: created, createdCount: created.length });
    }
    const egg = path.match(/^eggs\/([^/]+)$/);
    if (egg && ["PATCH", "DELETE"].includes(method)) {
      const index = state.eggs.findIndex(item => item.id === egg[1]);
      if (method === "PATCH" && index >= 0) state.eggs[index] = { ...state.eggs[index], ...body };
      if (method === "DELETE" && index >= 0) state.eggs.splice(index, 1);
      return respond({});
    }
    const clutchLogs = path.match(/^clutches\/([^/]+)\/incubation-logs$/);
    if (clutchLogs && method === "GET") return respond(itemsResponse("logs", state.incubationLogs.filter(item => item.clutchId === clutchLogs[1])));
    if (clutchLogs && method === "POST") {
      const created = { id: nextId("log"), clutchId: clutchLogs[1], ...body };
      state.incubationLogs.push(created);
      return respond({ log: created });
    }
    const incubationLog = path.match(/^incubation-logs\/([^/]+)$/);
    if (incubationLog && ["PATCH", "DELETE"].includes(method)) {
      const index = state.incubationLogs.findIndex(item => item.id === incubationLog[1]);
      if (method === "PATCH" && index >= 0) state.incubationLogs[index] = { ...state.incubationLogs[index], ...body };
      if (method === "DELETE" && index >= 0) state.incubationLogs.splice(index, 1);
      return respond({});
    }
    if (path === "offspring-batches" && method === "GET") {
      const cycleId = url.searchParams.get("cycleId");
      const list = cycleId ? state.batches.filter(item => item.cycleId === cycleId) : state.batches;
      return respond(itemsResponse("offspringBatches", list));
    }
    if (path === "offspring-batches" && method === "POST") {
      const created = { id: nextId("batch"), ...body, count: Number(body.count) };
      state.batches.push(created);
      return respond({ offspringBatch: created, batch: created });
    }
    const batchAnimals = path.match(/^offspring-batches\/([^/]+)\/animals$/);
    if (batchAnimals && method === "POST") {
      const created = (body.animals || []).map(item => makeAnimal({ ...item, id: nextId("animal") }));
      state.animals.push(...created);
      return respond({ createdCount: created.length, animals: created });
    }
    const batch = path.match(/^offspring-batches\/([^/]+)$/);
    if (batch && ["PATCH", "DELETE"].includes(method)) {
      const index = state.batches.findIndex(item => item.id === batch[1]);
      if (method === "PATCH" && index >= 0) state.batches[index] = { ...state.batches[index], ...body };
      if (method === "DELETE" && index >= 0) state.batches.splice(index, 1);
      return respond({});
    }

    if (path === "documents" && method === "GET") { if (state.documentListDelayMs) await new Promise(resolve => setTimeout(resolve, state.documentListDelayMs)); if (state.failDocumentList) return respond({ message: "Errore caricamento documenti E2E." }, 503); return respond(itemsResponse("documents", state.documents)); }
    if (path === "documents" && method === "POST") {
      const created = {
        id: nextId("doc"), originalFilename: headers["x-document-name"] || "documento.pdf",
        category: headers["x-document-category"] || "other", note: headers["x-document-note"] || null,
        sizeBytes: request.postDataBuffer()?.length || 1024, createdAt: "2026-10-29T10:00:00.000Z",
        animalId: headers["x-animal-id"] || null, cycleId: headers["x-cycle-id"] || null
      };
      state.documents.push(created);
      return respond({ document: created });
    }
    const document = path.match(/^documents\/([^/]+)$/);
    if (document && method === "PATCH") {
      const index = state.documents.findIndex(item => item.id === document[1]);
      if (index >= 0) state.documents[index] = { ...state.documents[index], ...body };
      return respond({ document: state.documents[index] || null });
    }
    if (document && method === "DELETE") { state.documents = state.documents.filter(item => item.id !== document[1]); return respond({}); }
    const publicAnimal = path.match(/^public\/animals\/([^/]+)$/);
    if (publicAnimal && method === "GET") {
      return state.share?.isEnabled
        ? respond({ animal: state.animals.find(item => item.id === state.share.animalId) || state.animals[0], description: state.share.publicDescription || "", visibleFields: state.share.visibleFields || ["name", "species", "morph"] })
        : respond({ message: "Profilo non disponibile." }, 404);
    }

    if (path === "notifications" && method === "GET") { if (state.notificationListDelayMs) await new Promise(resolve => setTimeout(resolve, state.notificationListDelayMs)); if (state.failNotificationList) return respond({ message: "Errore caricamento notifiche E2E." }, 503); return respond({ notifications: state.notifications, unreadCount: state.unreadCount, pagination: pagination(state.notifications) }); }
    if (path === "notification-preferences" && method === "GET") return respond({ preferences: state.preferences });
    if (path === "notification-preferences" && method === "PATCH") {
      state.preferences = { ...state.preferences, ...body, categories: { ...state.preferences.categories, ...(body.categories || {}) } };
      return respond({ preferences: state.preferences });
    }
    if (path === "push-subscriptions" && method === "GET") return respond({ subscriptions: state.devices, pagination: pagination(state.devices) });
    if (path === "push-subscriptions" && method === "POST") {
      const created = { id: nextId("device"), userAgent: body.userAgent || "Browser E2E", createdAt: new Date().toISOString() };
      state.devices.push(created);
      return respond({ subscription: created });
    }
    const device = path.match(/^push-subscriptions\/([^/]+)$/);
    if (device && method === "DELETE") { state.devices = state.devices.filter(item => item.id !== device[1]); return respond({}); }
    if (path === "notifications/read-all" && method === "POST") {
      state.notifications = state.notifications.map(item => ({ ...item, readAt: new Date().toISOString() }));
      state.unreadCount = 0;
      return respond({});
    }
    const readNotification = path.match(/^notifications\/([^/]+)\/read$/);
    if (readNotification && method === "PATCH") {
      state.notifications = state.notifications.map(item => item.id === readNotification[1] ? { ...item, readAt: new Date().toISOString() } : item);
      state.unreadCount = state.notifications.filter(item => !item.readAt).length;
      return respond({});
    }
    if (path === "notifications/test-push" && method === "POST") return respond({ delivery: { attempted: 1, sent: 1, failed: 0 } });
    if (path === "exports" && method === "POST") return respond({ export: { id: "export-1", status: "processing" } }, 202);
    if (path === "exports/export-1" && method === "GET") return respond({ export: { id: "export-1", status: "completed" }, ready: true });
    if (path.startsWith("imports") || path.startsWith("inventory/") || path.startsWith("finance/") || path.startsWith("tasks")) return respond({});
    return respond({});
  });

  return state;
}

export async function signIn(page) {
  await expect(page.getByRole("heading", { name: "Accedi a Vivarqo" })).toBeVisible();
  await page.getByLabel("Email").fill("allevatore@example.test");
  await page.getByLabel("Password").fill("Password-di-test-123!");
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}
