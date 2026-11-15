import type {
  ClutchDto,
  EggDto,
  IncubationLogDto,
  OffspringBatchDto,
  ReproductiveEventDto,
  ReproductionCycleDto,
  ReproductionCycleSummaryDto,
  ClutchDetailDto,
} from "@vivarqo/contracts/reproduction";

export const cycleStatuses = ["planned", "active", "completed", "cancelled"] as const;
export const eventTypes = ["pairing", "pairing_failed", "no_deposition", "observation", "ovulation", "gravid", "laying", "live_birth", "incubation_start", "hatch", "infertile_clutch", "embryonic_loss", "stillbirth", "post_hatch_loss", "loss", "other"] as const;

export type CycleEditTarget = ReproductionCycleSummaryDto;
export type CycleDetailEditTarget = ReproductiveEventDto | ClutchDto | OffspringBatchDto;
