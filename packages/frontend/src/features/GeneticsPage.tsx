import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { Locale } from "../lib/domain";
import { Alert, Button, LoadingState, PageHeader, Panel } from "../components/ui";

type Allele = { id: string; symbol: string; name: string; isReference: boolean };
type Locus = { id: string; symbol: string; name: string; inheritanceMode: string; alleles: Allele[] };
type Gene = { id: string; species: string; symbol: string; name: string; loci: Locus[] };
type Animal = { id: string; name: string; species: string };
type Trait = { id: string; traitName: string; traitValue: string; genotype: string | null; theoreticalGenotype: string | null; observedPhenotype: string | null; confirmedGenotype: string | null; certainty: string; locusId: string | null };
const modes = ["autosomal_recessive", "dominant", "incomplete_dominant", "codominant"];
const labels: Record<string, string> = { autosomal_recessive: "Recessiva", dominant: "Dominante", incomplete_dominant: "Dominanza incompleta", codominant: "Codominante" };

export function GeneticsPage({ locale }: { locale: Locale }) {
  const en = locale === "en";
  const [genes, setGenes] = useState<Gene[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [traits, setTraits] = useState<Trait[]>([]);
  const [animalId, setAnimalId] = useState("");
  const [geneForm, setGeneForm] = useState({ species: "", symbol: "", name: "" });
  const [locusForm, setLocusForm] = useState({ geneId: "", symbol: "", name: "", inheritanceMode: "autosomal_recessive" });
  const [alleleForm, setAlleleForm] = useState({ locusId: "", symbol: "", name: "", isReference: false });
  const [traitForm, setTraitForm] = useState({ locusId: "", traitName: "", traitValue: "", theoreticalGenotype: "", observedPhenotype: "", confirmedGenotype: "", certainty: "unverified" });
  const [pair, setPair] = useState({ motherAnimalId: "", fatherAnimalId: "", locusId: "" });
  const [calculation, setCalculation] = useState<unknown>(null);
  const [inbreeding, setInbreeding] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; changedAt: string; snapshot: Record<string, unknown> }>>([]);
  const [pedigree, setPedigree] = useState<{ nodes: Array<{ id: string; name: string; species: string; generation: number }>; missingParents: Array<{ childId: string; role: string; description: string | null }> } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const text = (it: string, enText: string) => en ? enText : it;

  async function loadCatalog() {
    const result = await api.get<{ genes: Gene[] }>("/genetics/catalog");
    setGenes(result.genes);
    if (!locusForm.geneId && result.genes[0]) setLocusForm((value) => ({ ...value, geneId: result.genes[0]!.id }));
    const firstLocus = result.genes.flatMap((gene) => gene.loci)[0];
    if (firstLocus) {
      setPair((value) => ({ ...value, locusId: value.locusId || firstLocus.id }));
      setTraitForm((value) => ({ ...value, locusId: value.locusId || firstLocus.id }));
      setAlleleForm((value) => ({ ...value, locusId: value.locusId || firstLocus.id }));
    }
  }
  async function loadAnimalData(id: string) {
    if (!id) { setTraits([]); setHistory([]); setInbreeding(null); return; }
    const [traitResult, historyResult, inbreedingResult, pedigreeResult] = await Promise.all([
      api.get<{ traits: Trait[] }>(`/animals/${id}/genetic-traits`),
      api.get<{ history: Array<{ id: string; changedAt: string; snapshot: Record<string, unknown> }> }>(`/animals/${id}/genetic-history`),
      api.get<{ inbreeding: Record<string, unknown> }>(`/animals/${id}/inbreeding`),
      api.get<{ nodes: Array<{ id: string; name: string; species: string; generation: number }>; missingParents: Array<{ childId: string; role: string; description: string | null }> }>(`/animals/${id}/pedigree`),
    ]);
    setTraits(traitResult.traits); setHistory(historyResult.history); setInbreeding(inbreedingResult.inbreeding); setPedigree(pedigreeResult);
  }
  useEffect(() => {
    let active = true;
    Promise.all([
      api.get<{ animals: Animal[] }>("/animals?page=1&pageSize=100&status=all"),
      api.get<{ genes: Gene[] }>("/genetics/catalog"),
    ]).then(([animalResult, catalogResult]) => {
      if (!active) return;
      setAnimals(animalResult.animals); setGenes(catalogResult.genes);
      if (animalResult.animals[0]) setAnimalId(animalResult.animals[0].id);
      if (catalogResult.genes[0]) setLocusForm((v) => ({ ...v, geneId: catalogResult.genes[0]!.id }));
      const locus = catalogResult.genes.flatMap((gene) => gene.loci)[0];
      if (locus) {
        setPair((v) => ({ ...v, locusId: locus.id })); setTraitForm((v) => ({ ...v, locusId: locus.id })); setAlleleForm((v) => ({ ...v, locusId: locus.id }));
      }
    }).catch((reason: unknown) => setError(reason instanceof ApiError ? reason.message : text("Impossibile caricare i dati genetici.", "Could not load genetics data."))).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { void loadAnimalData(animalId).catch((reason: unknown) => setError(reason instanceof ApiError ? reason.message : "Request failed")); }, [animalId]);
  const loci = useMemo(() => genes.flatMap((gene) => gene.loci.map((locus) => ({ ...locus, geneName: gene.name, species: gene.species }))), [genes]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await loadCatalog(); if (animalId) await loadAnimalData(animalId); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : text("Operazione non riuscita.", "Operation failed.")); }
    finally { setBusy(false); }
  }
  async function createGene(event: FormEvent) { event.preventDefault(); await run(async () => { await api.post("/genetics/genes", geneForm); setGeneForm({ species: "", symbol: "", name: "" }); }); }
  async function createLocus(event: FormEvent) { event.preventDefault(); await run(async () => { await api.post(`/genetics/genes/${locusForm.geneId}/loci`, { symbol: locusForm.symbol, name: locusForm.name, inheritanceMode: locusForm.inheritanceMode }); setLocusForm((v) => ({ ...v, symbol: "", name: "" })); }); }
  async function createAllele(event: FormEvent) { event.preventDefault(); await run(async () => { await api.post(`/genetics/loci/${alleleForm.locusId}/alleles`, alleleForm); setAlleleForm((v) => ({ ...v, symbol: "", name: "", isReference: false })); }); }
  async function createTrait(event: FormEvent) { event.preventDefault(); await run(async () => { await api.post(`/animals/${animalId}/genetic-traits`, { traitName: traitForm.traitName, traitValue: traitForm.traitValue, locusId: traitForm.locusId || null, theoreticalGenotype: traitForm.theoreticalGenotype || null, observedPhenotype: traitForm.observedPhenotype || null, confirmedGenotype: traitForm.confirmedGenotype || null, certainty: traitForm.certainty }); setTraitForm((v) => ({ ...v, traitName: "", traitValue: "", theoreticalGenotype: "", observedPhenotype: "", confirmedGenotype: "" })); }); }
  async function calculate(event: FormEvent) { event.preventDefault(); await run(async () => { const result = await api.post<{ calculation: unknown }>("/genetics/calculate-pairing", { motherAnimalId: pair.motherAnimalId, fatherAnimalId: pair.fatherAnimalId, locusIds: [pair.locusId] }); setCalculation(result.calculation); }); }
  if (loading) return <LoadingState />;
  return <div className="page-stack">
    <PageHeader title={text("Genetica", "Genetics")} description={text("Catalogo di geni, loci e alleli; schede genetiche, incroci e genealogia.", "Gene, locus and allele catalog; animal records, pairings and pedigree.")} />
    {error && <Alert tone="danger">{error}</Alert>}
    <Panel><h2>{text("Catalogo genetico", "Genetics catalog")}</h2>
      <form className="form-grid" onSubmit={(e) => void createGene(e)}>
        <label>{text("Specie", "Species")}<input required maxLength={160} value={geneForm.species} onChange={(e) => setGeneForm({ ...geneForm, species: e.target.value })} /></label>
        <label>{text("Simbolo gene", "Gene symbol")}<input required maxLength={40} value={geneForm.symbol} onChange={(e) => setGeneForm({ ...geneForm, symbol: e.target.value })} /></label>
        <label>{text("Nome gene", "Gene name")}<input required maxLength={160} value={geneForm.name} onChange={(e) => setGeneForm({ ...geneForm, name: e.target.value })} /></label>
        <Button type="submit" disabled={busy}>{text("Aggiungi gene", "Add gene")}</Button>
      </form>
      <div className="genetics-catalog">{genes.map((gene) => <section key={gene.id}><h3>{gene.name} <small>({gene.symbol}) · {gene.species}</small></h3><form className="form-grid" onSubmit={(e) => void createLocus(e)}>
        <input aria-label="Gene" type="hidden" value={gene.id} />
        <label>{text("Simbolo locus", "Locus symbol")}<input required value={locusForm.geneId === gene.id ? locusForm.symbol : ""} onChange={(e) => setLocusForm({ ...locusForm, geneId: gene.id, symbol: e.target.value })} /></label>
        <label>{text("Nome locus", "Locus name")}<input required value={locusForm.geneId === gene.id ? locusForm.name : ""} onChange={(e) => setLocusForm({ ...locusForm, geneId: gene.id, name: e.target.value })} /></label>
        <label>{text("Ereditarietà", "Inheritance")}<select value={locusForm.inheritanceMode} onChange={(e) => setLocusForm({ ...locusForm, geneId: gene.id, inheritanceMode: e.target.value })}>{modes.map((mode) => <option key={mode} value={mode}>{labels[mode]}</option>)}</select></label>
        <Button type="submit" disabled={busy}>{text("Aggiungi locus", "Add locus")}</Button>
      </form>
      {gene.loci.map((locus) => <div className="genetics-locus" key={locus.id}><strong>{locus.name} ({locus.symbol})</strong> · {labels[locus.inheritanceMode] ?? locus.inheritanceMode}<ul>{locus.alleles.map((allele) => <li key={allele.id}>{allele.symbol} — {allele.name}{allele.isReference ? " · reference" : ""}</li>)}</ul>
        <form className="form-grid" onSubmit={(e) => void createAllele(e)}>
          <label>{text("Allele", "Allele")}<input required value={alleleForm.locusId === locus.id ? alleleForm.symbol : ""} onChange={(e) => setAlleleForm({ ...alleleForm, locusId: locus.id, symbol: e.target.value })} /></label>
          <label>{text("Nome allele", "Allele name")}<input required value={alleleForm.locusId === locus.id ? alleleForm.name : ""} onChange={(e) => setAlleleForm({ ...alleleForm, locusId: locus.id, name: e.target.value })} /></label>
          <label className="checkbox-field"><input type="checkbox" checked={alleleForm.locusId === locus.id && alleleForm.isReference} onChange={(e) => setAlleleForm({ ...alleleForm, locusId: locus.id, isReference: e.target.checked })} />{text("Allele di riferimento", "Reference allele")}</label>
          <Button type="submit" disabled={busy}>{text("Aggiungi allele", "Add allele")}</Button>
        </form>
      </div>)}</section>)}</div>
    </Panel>
    <Panel><h2>{text("Scheda genetica animale", "Animal genetic record")}</h2>
      <label>{text("Animale", "Animal")}<select value={animalId} onChange={(e) => setAnimalId(e.target.value)}><option value="">—</option>{animals.map((animal) => <option key={animal.id} value={animal.id}>{animal.name} · {animal.species}</option>)}</select></label>
      {animalId && <><form className="form-grid" onSubmit={(e) => void createTrait(e)}>
        <label>{text("Locus", "Locus")}<select value={traitForm.locusId} onChange={(e) => setTraitForm({ ...traitForm, locusId: e.target.value })}><option value="">—</option>{loci.map((locus) => <option key={locus.id} value={locus.id}>{locus.geneName} / {locus.name}</option>)}</select></label>
        <label>{text("Carattere", "Trait")}<input required value={traitForm.traitName} onChange={(e) => setTraitForm({ ...traitForm, traitName: e.target.value })} /></label>
        <label>{text("Valore", "Value")}<input required value={traitForm.traitValue} onChange={(e) => setTraitForm({ ...traitForm, traitValue: e.target.value })} /></label>
        <label>{text("Genotipo teorico", "Theoretical genotype")}<input placeholder="A|a oppure A|?" value={traitForm.theoreticalGenotype} onChange={(e) => setTraitForm({ ...traitForm, theoreticalGenotype: e.target.value })} /></label>
        <label>{text("Fenotipo osservato", "Observed phenotype")}<input value={traitForm.observedPhenotype} onChange={(e) => setTraitForm({ ...traitForm, observedPhenotype: e.target.value })} /></label>
        <label>{text("Genotipo confermato", "Confirmed genotype")}<input value={traitForm.confirmedGenotype} onChange={(e) => setTraitForm({ ...traitForm, confirmedGenotype: e.target.value })} /></label>
        <label>{text("Attendibilità", "Certainty")}<select value={traitForm.certainty} onChange={(e) => setTraitForm({ ...traitForm, certainty: e.target.value })}>{["confirmed", "visual", "possible", "carrier", "unverified"].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <Button type="submit" disabled={busy}>{text("Registra carattere", "Save trait")}</Button>
      </form>
      <ul>{traits.map((trait) => <li key={trait.id}><strong>{trait.traitName}</strong> · {trait.traitValue} — {text("teorico", "theoretical")}: {trait.theoreticalGenotype || "—"}; {text("osservato", "observed")}: {trait.observedPhenotype || "—"}; {text("confermato", "confirmed")}: {trait.confirmedGenotype || "—"} ({trait.certainty})</li>)}</ul>
      <h3>{text("Consanguineità e genealogia", "Inbreeding and pedigree")}</h3>{inbreeding && <p>{text("Completezza", "Completeness")}: {String(inbreeding.completeness)} · {text("Coefficient", "Coefficient")}: {inbreeding.coefficient === null ? text("non calcolabile con dati incompleti", "not available with incomplete data") : String(inbreeding.coefficient)} · {String(inbreeding.note)}</p>}
      <h3>{text("Genealogia registrata", "Recorded pedigree")}</h3><ul>{pedigree?.nodes.map((node) => <li key={node.id}>{node.name} · {node.species} · {text("generazione", "generation")} {node.generation}</li>)}</ul>{pedigree?.missingParents.map((parent, index) => <p key={parent.childId + parent.role + index}>{text("Genitore non registrato", "Unrecorded parent")}: {parent.role}{parent.description ? " — " + parent.description : ""}</p>)}
      <h3>{text("Storico genetico", "Genetic history")}</h3><ul>{history.map((item) => <li key={item.id}>{new Date(item.changedAt).toLocaleString(en ? "en-GB" : "it-IT")} · {String(item.snapshot.traitName ?? "Trait")}</li>)}</ul>
      </>}
    </Panel>
    <Panel><h2>{text("Calcolo incrocio", "Pairing calculator")}</h2><form className="form-grid" onSubmit={(e) => void calculate(e)}>
      <label>{text("Genitore A", "Parent A")}<select required value={pair.motherAnimalId} onChange={(e) => setPair({ ...pair, motherAnimalId: e.target.value })}><option value="">—</option>{animals.map((animal) => <option key={animal.id} value={animal.id}>{animal.name} · {animal.species}</option>)}</select></label>
      <label>{text("Genitore B", "Parent B")}<select required value={pair.fatherAnimalId} onChange={(e) => setPair({ ...pair, fatherAnimalId: e.target.value })}><option value="">—</option>{animals.map((animal) => <option key={animal.id} value={animal.id}>{animal.name} · {animal.species}</option>)}</select></label>
      <label>{text("Locus", "Locus")}<select required value={pair.locusId} onChange={(e) => setPair({ ...pair, locusId: e.target.value })}>{loci.map((locus) => <option key={locus.id} value={locus.id}>{locus.geneName} / {locus.name}</option>)}</select></label>
      <Button type="submit" disabled={busy || !pair.locusId || !pair.motherAnimalId || !pair.fatherAnimalId || pair.motherAnimalId === pair.fatherAnimalId}>{text("Calcola probabilità", "Calculate probabilities")}</Button>
    </form><p>{text("Il calcolo usa i genotipi confermati o teorici salvati nelle schede dei genitori. Se mancano, il risultato segnala il locus come incompleto.", "The calculation uses confirmed or theoretical genotypes stored on the parents. Missing values are reported as incomplete.")}</p>{calculation && <pre className="genetics-result">{JSON.stringify(calculation, null, 2)}</pre>}</Panel>
  </div>;
}
