import type { ModelContext } from "./webmcp";

declare global {
  interface Document {
    readonly modelContext?: ModelContext;
  }

  interface Navigator {
    readonly modelContext?: ModelContext;
  }
}

export {};
