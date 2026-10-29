const DB_NAME = "vivarqo-offline-outbox";
const DB_VERSION = 1;
const STORE = "mutations";
const MAX_MUTATIONS = 250;
const MAX_BODY_CHARS = 64 * 1024;
function notifyChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("vivarqo:offline-queue-changed"));
}
function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Questo browser non supporta la coda offline."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("owner", "owner", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Impossibile aprire la coda offline."));
    request.onblocked = () => reject(new Error("Chiudi le altre schede di Vivarqo per aggiornare la coda offline."));
  });
}
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Errore nella coda offline."));
    tx.onabort = () => reject(tx.error || new Error("Operazione offline annullata."));
  });
}
const storageKey = (owner, id) => String(owner) + "::" + String(id);
export async function enqueueOfflineMutation(owner, mutation) {
  if (!owner) throw new Error("Non riesco ad associare la modifica offline al tuo account.");
  const serialized = JSON.stringify(mutation.body ?? null);
  if (serialized.length > MAX_BODY_CHARS) throw new Error("Questa modifica è troppo grande per la coda offline. Riprova quando la connessione è disponibile.");
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE);
    const count = await new Promise((resolve, reject) => {
      const req = store.index("owner").count(String(owner));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (count >= MAX_MUTATIONS) {
      tx.abort();
      await done.catch(() => {});
      throw new Error("La coda offline ha raggiunto il limite di sicurezza di 250 modifiche. Sincronizza prima di aggiungerne altre.");
    }
    const id = crypto.randomUUID();
    const item = { key: storageKey(owner, id), id, owner: String(owner), method: mutation.method, path: mutation.path,
      body: mutation.body ?? null, label: mutation.label || mutation.method + " " + mutation.path,
      createdAt: new Date().toISOString(), status: "queued", error: null };
    store.add(item);
    await done;
    notifyChanged();
    return { queuedOffline: true, id, createdAt: item.createdAt };
  } finally { db.close(); }
}
export async function listOfflineMutations(owner) {
  if (!owner) return [];
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE);
    const items = await new Promise((resolve, reject) => {
      const req = store.index("owner").getAll(String(owner));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const result = items.map(item => {
      if (item.status !== "syncing") return item;
      const uncertain = { ...item, status: "uncertain", error: "L'app si è chiusa durante l'invio. Verifica i dati sul server prima di riprovare." };
      store.put(uncertain);
      return uncertain;
    });
    await done;
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } finally { db.close(); }
}
export async function updateOfflineMutation(owner, id, patch) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE);
    const key = storageKey(owner, id);
    const item = await new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (item) store.put({ ...item, ...patch, key, owner: String(owner), updatedAt: new Date().toISOString() });
    await done;
    if (patch.status !== "syncing") notifyChanged();
  } finally { db.close(); }
}
export async function removeOfflineMutation(owner, id) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    tx.objectStore(STORE).delete(storageKey(owner, id));
    await done;
    notifyChanged();
  } finally { db.close(); }
}
export async function clearOfflineMutations(owner) {
  if (!owner) return;
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE);
    const keys = await new Promise((resolve, reject) => {
      const req = store.index("owner").getAllKeys(String(owner));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    for (const key of keys) store.delete(key);
    await done;
    notifyChanged();
  } finally { db.close(); }
}