export type AnimalSexDto = "male" | "female" | "unknown";
export type AnimalStatusDto = "active" | "sold" | "transferred" | "deceased" | "archived";
export type AnimalCategoryDto = "reptiles" | "fish" | "birds" | "dogs_cats";
export type AnimalDomainProfileDto =
  | { enclosure?: string | null; brumation?: "not_applicable" | "planned" | "in_progress" | "completed"; feedingNotes?: string | null }
  | { aquariumId?: string | null; waterType?: "freshwater" | "saltwater" | "brackish"; temperament?: string | null; maxSizeCm?: number | null; shoaling?: boolean; diet?: string | null }
  | { aviaryId?: string | null; diet?: string | null; tameness?: "wild" | "socialized" | "tame"; flightStatus?: "full_flight" | "clipped" | "unknown" }
  | { breed?: string | null; microchip?: string | null; veterinarianName?: string | null; veterinaryClinic?: string | null; veterinaryPhone?: string | null; veterinaryEmail?: string | null; veterinaryAddress?: string | null; allergies?: string | null; chronicConditions?: string | null; sterilized?: boolean; vaccinationStatus?: "unknown" | "not_up_to_date" | "up_to_date"; coatColor?: string | null; weightKg?: number | null };

export interface AnimalDto {
  id: string;
  name: string;
  identifier: string | null;
  species: string;
  category: AnimalCategoryDto;
  domainProfile: AnimalDomainProfileDto | null;
  sex: AnimalSexDto;
  morph: string | null;
  motherAnimalId?: string | null;
  fatherAnimalId?: string | null;
  motherDescription?: string | null;
  fatherDescription?: string | null;
  originOffspringBatchId?: string | null;
  originClutchId?: string | null;
  mother?: Pick<AnimalDto, "id" | "name" | "morph" | "sex"> | null;
  father?: Pick<AnimalDto, "id" | "name" | "morph" | "sex"> | null;
  geneticsNotes: string | null;
  birthDate: string | null;
  birthDateEstimated: boolean;
  acquiredDate: string | null;
  originDescription: string | null;
  previousBreeder: string | null;
  locationLabel: string | null;
  locationId?: string | null;
  feedingIntervalDays?: number | null;
  status: AnimalStatusDto;
  notes: string | null;
  photoUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface WeightDto {
  id: string;
  animalId: string;
  measuredAt: string;
  weightG: number;
  notes: string | null;
  createdAt?: string;
}

export interface ShedDto {
  id: string;
  animalId: string;
  occurredAt: string;
  outcome: "complete" | "partial" | "unknown";
  notes: string | null;
}

export interface AnimalNoteDto {
  id: string;
  animalId: string;
  occurredAt: string;
  title: string | null;
  category: string;
  body: string;
}

export type CareRecordDto = WeightDto | ShedDto | AnimalNoteDto;

export interface AnimalDocumentDto {
  id: string;
  animalId: string | null;
  originalFilename: string;
  category: string | null;
  createdAt: string;
}

export interface GeneticTraitSourceAnimalDto {
  id: string;
  name: string;
  identifier: string | null;
  species: string;
}

export interface GeneticTraitDto {
  id: string;
  animalId: string;
  traitName: string;
  traitValue: string;
  sourceAnimalId: string | null;
  sourceAnimal?: GeneticTraitSourceAnimalDto | null;
  confidenceNote: string | null;
  inheritanceMode?: "autosomal_recessive" | "incomplete_dominant" | "dominant" | null;
  genotype?: string | null;
  phenotypeRules?: Record<string, string> | null;
  certainty?: "confirmed" | "visual" | "possible" | "carrier" | "unverified";
}

export interface PublicShareDto {
  id: string;
  animalId: string;
  isEnabled: boolean;
  publicDescription: string | null;
  visibleFields: string[];
  url: string;
}
