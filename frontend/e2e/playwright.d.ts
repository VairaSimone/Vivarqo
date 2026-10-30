import type { E2EState } from "./fixtures";

declare module "@playwright/test" {
  interface Page {
    e2eState: E2EState;
  }
}

export {};
