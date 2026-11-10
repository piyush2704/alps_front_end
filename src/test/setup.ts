import { transferableAbortController } from "node:util";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { cache, cancel } from "../api/client";
// Node fetch requires Node-branded signals; jsdom otherwise replaces this global.
globalThis.AbortController = transferableAbortController()
  .constructor as typeof AbortController;
globalThis.AbortSignal = new AbortController().signal
  .constructor as typeof AbortSignal;
export const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  cache.forEach((entry) => cancel(entry));
  cache.clear();
  server.resetHandlers();
});
afterAll(() => server.close());
