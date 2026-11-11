export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  category: string;
  dueAt: string;
  status: "open" | "completed" | "dismissed" | string;
  animalId: string | null;
  animal?: { id: string; name: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReminderRuleDto {
  id: string;
  title: string;
  category: string;
  intervalDays: number;
  nextDueAt: string;
  animalId: string | null;
  isEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CalendarItemDto {
  id: string;
  title: string;
  type: string;
  start: string;
  status: string;
  targetPath: string | null;
}
