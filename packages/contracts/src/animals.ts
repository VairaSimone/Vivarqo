export type AnimalSexDto = "male" | "female" | "unknown";
export type AnimalStatusDto = "active" | "sold" | "transferred" | "deceased" | "archived";

export interface AnimalDto {
  id: string;
  name: string;
  identifier: string | null;
  species: string;
  sex: AnimalSexDto;
  morph: string | null;
  geneticsNotes: string | null;
  birthDate: string | null;
  birthDateEstimated: boolean;
  acquiredDate: string | null;
  originDescription: string | null;
  previousBreeder: string | null;
  locationLabel: string | null;
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

export interface GeneticTraitDto {
  id: string;
  animalId: string;
  traitName: string;
  traitValue: string;
  confidenceNote: string | null;
}

export interface PublicShareDto {
  id: string;
  animalId: string;
  isEnabled: boolean;
  publicDescription: string | null;
  visibleFields: string[];
  url: string;
}
