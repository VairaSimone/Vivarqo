import { describe, expect, it } from "vitest";
import { createTaskSchema, taskListQuerySchema } from "../src/modules/operations/operations.schemas.js";

describe("task category contracts", () => {
  it("accepts incubation monitoring tasks and category filters", () => {
    expect(createTaskSchema.safeParse({
      title: "Controllo incubazione",
      category: "incubation",
      dueAt: "2026-11-16T10:00:00.000Z",
    }).success).toBe(true);
    expect(taskListQuerySchema.safeParse({ category: "incubation" }).success).toBe(true);
  });
});
