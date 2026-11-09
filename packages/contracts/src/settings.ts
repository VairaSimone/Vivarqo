export interface AccountPreferencesDto {
  weightUnit: "g" | "kg" | "oz" | "lb" | string;
  temperatureUnit: "c" | "f" | string;
  dateFormat: "locale" | "dd/MM/yyyy" | "yyyy-MM-dd" | string;
  defaultLandingPage: string;
  compactTables: boolean;
  theme: "system" | "light" | "dark" | string;
  timezone?: string;
}

export interface NotificationDto {
  id: string;
  targetPath: string | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPreferencesDto {
  inAppEnabled: boolean;
  pushEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  categories: Record<string, boolean>;
}

export interface PushSubscriptionDto {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
}

export interface BillingSubscriptionDto {
  id: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripePriceId: string | null;
}

export interface BillingEntitlementsDto {
  plan?: string;
  maxAnimals?: number | null;
  maxDocuments?: number | null;
  maxStorageBytes?: number | null;
  features?: string[];
}

export interface SettingsUserDto {
  id: string;
  email: string;
  displayName: string;
  locale: "it" | "en";
  timezone: string;
}
