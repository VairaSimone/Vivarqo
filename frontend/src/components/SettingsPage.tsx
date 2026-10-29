import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../api/api.js";
import { useConfirmDialog } from "../ui/ConfirmDialog.jsx";

type DisplayPreferences = {
  animalListDensity?: "comfortable" | "compact";
  defaultAnimalSort?: "name" | "createdAt" | "updatedAt";
  showArchivedAnimals?: boolean;
  dashboardStartSection?: "oggi" | "animali" | "alimentazioni" | "attivita";
};

type SettingsForm = {
  displayName: string;
  email: string;
  locale: "it" | "en";
  timezone: string;
  weightUnit: "g" | "kg" | "oz" | "lb";
  temperatureUnit: "C" | "F";
  animalListDensity: "comfortable" | "compact";
  defaultAnimalSort: "name" | "createdAt" | "updatedAt";
  showArchivedAnimals: boolean;
  dashboardStartSection: "oggi" | "animali" | "alimentazioni" | "attivita";
  currentPassword: string;
  newPassword: string;
};

type DeleteForm = {
  currentPassword: string;
  confirmation: string;
};

type SettingsUser = {
  id?: string;
  email?: string;
  displayName?: string;
  locale?: string;
  timezone?: string;
  weightUnit?: string;
  temperatureUnit?: string;
  displayPreferences?: DisplayPreferences;
};

type SettingsPageProps = {
  user: SettingsUser;
  onNotice: (message: string, type?: string) => void;
};

function Button({ children, variant = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return <button className={"button " + variant} {...props}>{children}</button>;
}

function Field({ label, error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return <label className="field"><span>{label}</span><input {...props}/>{error && <small className="error-text" role="alert">{error}</small>}</label>;
}

function SelectField({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>;
}

function displayDefaults(user: SettingsUser): SettingsForm {
  const display = user.displayPreferences ?? {};
  return {
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    locale: user.locale === "en" ? "en" : "it",
    timezone: user.timezone ?? "Europe/Rome",
    weightUnit: (["g", "kg", "oz", "lb"].includes(user.weightUnit ?? "") ? user.weightUnit : "g") as SettingsForm["weightUnit"],
    temperatureUnit: user.temperatureUnit === "F" ? "F" : "C",
    animalListDensity: display.animalListDensity ?? "comfortable",
    defaultAnimalSort: display.defaultAnimalSort ?? "name",
    showArchivedAnimals: display.showArchivedAnimals === true,
    dashboardStartSection: display.dashboardStartSection ?? "oggi",
    currentPassword: "",
    newPassword: "",
  };
}

export function SettingsPage({ user, onNotice }: SettingsPageProps) {
  const confirmAction = useConfirmDialog();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiRequest("auth/me"),
    staleTime: 30_000,
    retry: 0,
  });
  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("account", { method: "PATCH", body }),
    onSuccess: async (result) => {
      if (result.user) {
        queryClient.setQueryData(["auth", "me"], { user: result.user });
      } else {
        await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      }
    },
  });
  const [deletionRequested, setDeletionRequested] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<SettingsForm>({ defaultValues: displayDefaults(user) });
  const deletionForm = useForm<DeleteForm>({
    defaultValues: { currentPassword: "", confirmation: "" },
  });

  useEffect(() => {
    const latestUser = profileQuery.data?.user;
    if (latestUser) reset(displayDefaults(latestUser));
  }, [profileQuery.data, reset]);

  const save = async (values: SettingsForm) => {
    const body: Record<string, unknown> = {
      displayName: values.displayName,
      locale: values.locale,
      timezone: values.timezone,
      weightUnit: values.weightUnit,
      temperatureUnit: values.temperatureUnit,
      displayPreferences: {
        animalListDensity: values.animalListDensity,
        defaultAnimalSort: values.defaultAnimalSort,
        showArchivedAnimals: values.showArchivedAnimals,
        dashboardStartSection: values.dashboardStartSection,
      },
    };
    const emailChanged = values.email.trim().toLowerCase() !== (user.email ?? "").toLowerCase();
    const passwordChanged = values.newPassword.length > 0;
    if (emailChanged || passwordChanged) {
      body.email = values.email;
      body.currentPassword = values.currentPassword;
      if (passwordChanged) body.newPassword = values.newPassword;
    }

    try {
      const result = await saveMutation.mutateAsync(body);
      onNotice(result.message || "Impostazioni aggiornate.");
      if (result.user) {
        reset(displayDefaults(result.user));
        window.dispatchEvent(new CustomEvent("vivarqo:profile-updated", { detail: result.user }));
      } else if (emailChanged || passwordChanged) {
        window.location.reload();
      } else reset({ ...values, currentPassword: "", newPassword: "" });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Impossibile salvare le impostazioni.", "error");
    }
  };

  const deleteAccount = async (values: DeleteForm) => {
    if (values.confirmation !== "DELETE") {
      onNotice('Per confermare, scrivi esattamente "DELETE".', "error");
      return;
    }
    const confirmed = await confirmAction({
      title: "Cancellare definitivamente l'account?",
      message: "Le sessioni saranno revocate, i link pubblici disattivati e i dati privati e i file collegati verranno eliminati. L'operazione non può essere annullata. Gli eventuali obblighi legali di conservazione saranno gestiti separatamente.",
      confirmLabel: "Avvia cancellazione",
      danger: true,
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      await apiRequest("account", {
        method: "DELETE",
        body: { currentPassword: values.currentPassword, confirmation: "DELETE" },
      });
      setDeletionRequested(true);
      deletionForm.reset();
      onNotice("Cancellazione avviata. L'accesso è stato disattivato e i dati verranno rimossi dal sistema.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Impossibile avviare la cancellazione.", "error");
    } finally {
      setDeleting(false);
    }
  };

  if (deletionRequested) {
    return <section className="panel settings-panel" role="status">
      <p className="eyebrow">CANCELLAZIONE ACCOUNT</p>
      <h2>Richiesta avviata</h2>
      <p className="muted">L'accesso è stato disattivato. Il sistema sta eliminando i file privati e le relazioni dell'account tramite un processo controllato con tentativi persistenti.</p>
      <Button onClick={() => window.location.reload()}>Esci e torna alla schermata di accesso</Button>
    </section>;
  }

  return <div className="advanced-stack">
    <section className="panel settings-panel">
      <p className="eyebrow">PROFILO E PREFERENZE</p>
      <h2>Impostazioni account</h2>
      <p className="subheading">Lingua, fuso orario, unità e visualizzazione vengono salvati sul tuo account.</p>
      {profileQuery.isFetching && <p className="muted" role="status">Aggiornamento delle preferenze salvate…</p>}
      {profileQuery.isError && <p className="muted">Non è stato possibile aggiornare il profilo dal server; puoi comunque modificare i valori già caricati.</p>
      <form className="form-grid" onSubmit={handleSubmit(save)}>
        <Field label="Nome visualizzato" {...register("displayName", { required: "Inserisci un nome.", maxLength: { value: 120, message: "Massimo 120 caratteri." } })} />
        <Field label="Email" type="email" autoComplete="email" {...register("email", { required: "Inserisci un indirizzo email.", maxLength: 254 })} />
        <SelectField label="Lingua" {...register("locale")}><option value="it">Italiano</option><option value="en">English</option></SelectField>
        <Field label="Fuso orario IANA" {...register("timezone", { required: "Inserisci un fuso orario IANA." })}/>
        <SelectField label="Unità di peso" {...register("weightUnit")}><option value="g">Grammi (g)</option><option value="kg">Chilogrammi (kg)</option><option value="oz">Once (oz)</option><option value="lb">Libbre (lb)</option></SelectField>
        <SelectField label="Unità di temperatura" {...register("temperatureUnit")}><option value="C">Celsius (°C)</option><option value="F">Fahrenheit (°F)</option></SelectField>
        <SelectField label="Densità delle tabelle" {...register("animalListDensity")}><option value="comfortable">Confortevole</option><option value="compact">Compatta</option></SelectField>
        <SelectField label="Ordinamento animali predefinito" {...register("defaultAnimalSort")}><option value="name">Nome</option><option value="createdAt">Data di creazione</option><option value="updatedAt">Ultima modifica</option></SelectField>
        <SelectField label="Sezione iniziale preferita" {...register("dashboardStartSection")}><option value="oggi">Oggi</option><option value="animali">Animali</option><option value="alimentazioni">Alimentazioni</option><option value="attivita">Attività</option></SelectField>
        <label className="checkbox-field form-full"><input type="checkbox" {...register("showArchivedAnimals")}/><span>Mostra gli animali archiviati per impostazione predefinita</span></label>
        {errors.displayName?.message && <p className="error-text form-full">{errors.displayName.message}</p>}
        {errors.email?.message && <p className="error-text form-full">{errors.email.message}</p>}
        {errors.timezone?.message && <p className="error-text form-full">{errors.timezone.message}</p>}
        <div className="form-full"><p className="eyebrow">MODIFICHE SENSIBILI</p></div>
        <Field label="Password attuale (richiesta per cambiare email o password)" type="password" autoComplete="current-password" {...register("currentPassword")}/>
        <Field label="Nuova password (facoltativa, almeno 12 caratteri)" type="password" autoComplete="new-password" {...register("newPassword", { minLength: { value: 12, message: "La password deve contenere almeno 12 caratteri." } })} error={errors.newPassword?.message}/>
        <div className="form-full"><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Salvataggio…" : "Salva impostazioni"}</Button></div>
      </form>
      <div className="security-actions">
        <Button variant="secondary" onClick={async () => {
          if (!(await confirmAction({ title: "Revocare tutte le sessioni?", message: "Dovrai effettuare nuovamente l'accesso su tutti i dispositivi.", confirmLabel: "Revoca sessioni", danger: true }))) return;
          try {
            await apiRequest("auth/sessions/revoke-all", { method: "POST", body: {} });
            onNotice("Sessioni revocate. Effettua nuovamente l'accesso.");
          } catch (error) {
            onNotice(error instanceof Error ? error.message : "Impossibile revocare le sessioni.", "error");
          }
        }}>Revoca tutte le sessioni</Button>
      </div>
    </section>

    <section className="panel settings-panel danger-zone">
      <p className="eyebrow">PRIVACY E DIRITTI</p>
      <h2>Cancellazione account</h2>
      <p className="muted">La richiesta disattiva subito l'accesso e i link pubblici. Il processo elimina i dati relazionati e i file privati; eventuali conservazioni obbligatorie e la rotazione tecnica dei backup seguono le relative politiche.</p>
      <form className="form-grid" onSubmit={deletionForm.handleSubmit(deleteAccount)}>
        <Field label="Password attuale" type="password" autoComplete="current-password" {...deletionForm.register("currentPassword", { required: "Inserisci la password per confermare." })} error={deletionForm.formState.errors.currentPassword?.message}/>
        <Field label={'Scrivi "DELETE" per confermare'} autoComplete="off" {...deletionForm.register("confirmation", { required: true })}/>
        <div className="form-full"><Button type="submit" variant="danger" disabled={deleting}>{deleting ? "Avvio cancellazione…" : "Cancella definitivamente l'account"}</Button></div>
      </form>
    </section>
  </div>;
}
