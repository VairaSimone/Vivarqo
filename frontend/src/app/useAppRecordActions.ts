import { useRef, useState, type Dispatch, type SetStateAction, type FormEvent } from "react";
import { apiRequest } from "../api/api";
import type { AnyRecord, InventoryFiltersState, NavigationHandler, NoticeHandler } from "../types";
import { errorMessage, readFormValues } from "../types";
import type { ConfirmOptions } from "../ui/ConfirmDialog";
import type { ModalForm } from "./AppModals";

type ConfirmHandler = (options?: ConfirmOptions) => Promise<boolean>;

export interface AppRecordActionsOptions {
  active: string;
  modal: ModalForm | null;
  query: string;
  inventoryFilters: InventoryFiltersState;
  setModal: Dispatch<SetStateAction<ModalForm | null>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setListPages: Dispatch<SetStateAction<Record<string, number>>>;
  setInventoryFilters: Dispatch<SetStateAction<InventoryFiltersState>>;
  setHistoryItem: Dispatch<SetStateAction<AnyRecord | null>>;
  setFinanceRefreshKey: Dispatch<SetStateAction<number>>;
  loadData: (section?: string) => Promise<void>;
  go: NavigationHandler;
  onNotice: NoticeHandler;
  confirm: ConfirmHandler;
}

function localDateTime(value?: string | Date | null): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
    "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

export function useAppRecordActions(options: AppRecordActionsOptions) {
  const {
    active, modal, inventoryFilters, setModal, setQuery, setListPages,
    setInventoryFilters, setHistoryItem, setFinanceRefreshKey, loadData,
    go, onNotice, confirm
  } = options;
  const [savingEntity, setSavingEntity] = useState(false);
  const savingEntityRef = useRef(false);

  const updateInventoryFilter = (name: keyof InventoryFiltersState, value: string | boolean) => {
    setInventoryFilters(current => name === "lowStock"
      ? { ...current, lowStock: Boolean(value) }
      : { ...current, [name]: String(value) });
    setListPages(current => ({ ...current, inventario: 1 }));
    setHistoryItem(null);
  };
  const resetInventoryFilters = () => {
    setInventoryFilters({ active: "true", category: "", lowStock: false });
    setListPages(current => ({ ...current, inventario: 1 }));
    setHistoryItem(null);
  };
  const updateRecordSearch = (next: string) => {
    setQuery(next);
    setListPages(current => ({ ...current, [active]: 1 }));
  };

  const saveEntity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingEntityRef.current || !modal) return;
    savingEntityRef.current = true;
    setSavingEntity(true);
    const raw = readFormValues(event.currentTarget);
    const { endpoint, method = "POST", transform } = modal;
    try {
      await apiRequest(endpoint, { method, body: transform ? transform(raw) : raw });
      setModal(null);
      onNotice("Modifiche salvate.");
      if (active === "finanze") setFinanceRefreshKey(key => key + 1);
      await loadData(active);
    } catch (error) {
      onNotice(errorMessage(error), "error");
    } finally {
      savingEntityRef.current = false;
      setSavingEntity(false);
    }
  };

  const addAnimal = () => setModal({
    title: "Nuovo animale", endpoint: "animals",
    fields: [["name","Nome","text"],["identifier","Identificativo (facoltativo)","text"],["species","Specie","text"],["sex","Sesso","select"],["morph","Morph","text"],["birthDate","Data di nascita","date"],["locationLabel","Stabulazione / posizione","text"],["notes","Note","textarea"]],
    transform: values => ({ ...values, identifier: values.identifier || null, morph: values.morph || null, birthDate: values.birthDate || null, locationLabel: values.locationLabel || null, notes: values.notes || null })
  });
  const addInventory = () => setModal({
    title: "Nuovo articolo", endpoint: "inventory/items",
    fields: [["name","Nome","text"],["category","Categoria","select"],["unit","Unità","text"],["quantityOnHand","Quantità iniziale","number"],["minimumQuantity","Soglia minima","number"],["notes","Note","textarea"]],
    transform: values => ({ ...values, quantityOnHand: Number(values.quantityOnHand || 0), minimumQuantity: values.minimumQuantity === "" ? null : Number(values.minimumQuantity), notes: values.notes || null })
  });
  const addFinance = () => setModal({
    title: "Nuova voce economica", endpoint: "finance/entries",
    fields: [["entryType","Tipo","select"],["occurredOn","Data","date"],["amount","Importo (€)","number"],["category","Categoria","text"],["description","Descrizione","text"]],
    transform: values => ({ entryType: values.entryType, occurredOn: values.occurredOn, amountCents: Math.round(Number(values.amount) * 100), currency: "EUR", category: values.category, description: values.description })
  });
  const addTask = () => setModal({
    title: "Nuova attività", endpoint: "tasks",
    fields: [["title","Titolo","text"],["taskCategory","Categoria","select","custom"],["dueAt","Scadenza","datetime-local"],["description","Descrizione","text"]],
    transform: values => ({ title: values.title, category: values.taskCategory, dueAt: new Date(values.dueAt).toISOString(), description: values.description || null })
  });

  const openEditRecord = (row: AnyRecord) => {
    if (active === "animali") {
      setModal({
        title: "Modifica animale", endpoint: "animals/" + row.id, method: "PATCH",
        fields: [["name","Nome","text",row.name],["identifier","Identificativo (facoltativo)","text",row.identifier || ""],["species","Specie","text",row.species],["sex","Sesso","select",row.sex || "unknown"],["morph","Morph","text",row.morph || ""],["birthDate","Data di nascita","date",row.birthDate ? String(row.birthDate).slice(0,10) : ""],["locationLabel","Stabulazione / posizione","text",row.locationLabel || ""],["notes","Note","textarea",row.notes || ""]],
        transform: values => ({ name: values.name, identifier: values.identifier || null, species: values.species, sex: values.sex, morph: values.morph || null, birthDate: values.birthDate || null, locationLabel: values.locationLabel || null, notes: values.notes || null })
      });
      return;
    }
    if (active === "inventario") {
      setModal({
        title: "Modifica articolo", endpoint: "inventory/items/" + row.id, method: "PATCH",
        fields: [["name","Nome","text",row.name],["category","Categoria","select",row.category],["unit","Unità","text",row.unit],["minimumQuantity","Soglia minima","number",row.minimumQuantity ?? ""],["notes","Note","textarea",row.notes || ""]],
        transform: values => ({ name: values.name, category: values.category, unit: values.unit, minimumQuantity: values.minimumQuantity === "" ? null : Number(values.minimumQuantity), notes: values.notes || null })
      });
      return;
    }
    if (active === "attivita") {
      setModal({
        title: "Modifica attività", endpoint: "tasks/" + row.id, method: "PATCH",
        fields: [["title","Titolo","text",row.title],["taskCategory","Categoria","select",row.category || "custom"],["dueAt","Scadenza","datetime-local",row.dueAt ? new Date(row.dueAt).toISOString().slice(0,16) : ""],["description","Descrizione","textarea",row.description || ""]],
        transform: values => ({ title: values.title, category: values.taskCategory, dueAt: new Date(values.dueAt).toISOString(), description: values.description || null })
      });
      return;
    }
    if (active === "finanze") {
      setModal({
        title: "Modifica voce economica", endpoint: "finance/entries/" + row.id, method: "PATCH",
        fields: [["entryType","Tipo","select",row.entryType],["occurredOn","Data","date",row.occurredOn ? String(row.occurredOn).slice(0,10) : ""],["amount","Importo (€)","number",Number(row.amountCents || 0) / 100],["category","Categoria","text",row.category],["description","Descrizione","text",row.description]],
        transform: values => ({ entryType: values.entryType, occurredOn: values.occurredOn, amountCents: Math.round(Number(values.amount) * 100), category: values.category, description: values.description })
      });
    }
  };

  const deleteRecord = async (row: AnyRecord) => {
    if (!["animali", "inventario", "attivita", "finanze"].includes(active)) return;
    const inventory = active === "inventario";
    const accepted = await confirm({
      title: inventory ? "Archiviare l’articolo?" : "Eliminare il record?",
      message: inventory ? "L’articolo verrà archiviato e lo storico resterà consultabile." : "L’operazione non è reversibile. Se esistono record collegati, il server potrebbe impedirla.",
      confirmLabel: inventory ? "Archivia articolo" : "Elimina record",
      danger: !inventory
    });
    if (!accepted) return;
    const endpoint = active === "animali"
      ? "animals/" + row.id
      : inventory ? "inventory/items/" + row.id + "/archive"
      : active === "attivita" ? "tasks/" + row.id : "finance/entries/" + row.id;
    try {
      await apiRequest(endpoint, { method: inventory ? "POST" : "DELETE", body: inventory ? {} : undefined });
      onNotice(inventory ? "Articolo archiviato." : "Record eliminato.");
      if (active === "finanze") setFinanceRefreshKey(key => key + 1);
      await loadData(active);
    } catch (error) {
      onNotice(errorMessage(error), "error");
    }
  };

  const createInventoryMovement = (row: AnyRecord) => setModal({
    title: "Movimento di magazzino · " + row.name,
    endpoint: "inventory/items/" + row.id + "/movements",
    fields: [["movementType","Tipo movimento","select","in"],["quantity","Quantità","number","1"],["occurredAt","Data e ora","datetime-local",localDateTime()],["unitCostCents","Costo unitario (centesimi, facoltativo)","number",""],["reference","Riferimento (facoltativo)","text",""],["notes","Note","textarea",""]],
    transform: values => ({ movementType: values.movementType, quantity: Number(values.quantity), occurredAt: new Date(values.occurredAt).toISOString(), unitCostCents: values.unitCostCents === "" ? null : Number(values.unitCostCents), reference: values.reference || null, notes: values.notes || null })
  });
  const markTask = async (row: AnyRecord) => {
    try {
      await apiRequest("tasks/" + row.id + "/complete", { method: "POST", body: {} });
      onNotice("Attività aggiornata.");
      await loadData(active);
    } catch (error) {
      onNotice(errorMessage(error), "error");
    }
  };
  const createCare = (type: string) => {
    const destination = type === "weights" ? "peso" : type === "sheds" ? "mute" : "note";
    go(destination);
    onNotice("Seleziona l'animale e completa il modulo dedicato per registrare il dato.", "info");
  };

  return {
    updateInventoryFilter, resetInventoryFilters, updateRecordSearch, saveEntity, savingEntity,
    addAnimal, addInventory, addFinance, addTask, openEditRecord, deleteRecord,
    createInventoryMovement, markTask, createCare,
    actionButton: active === "inventario"
      ? ["＋ Nuovo articolo", addInventory] as const
      : active === "finanze" ? ["＋ Nuova voce", addFinance] as const : null
  };
}
