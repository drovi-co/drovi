import { setupServer } from "msw/node";

// Central MSW server for Node/jsdom tests.
// Tests should register request handlers via `server.use(...)`.
export const server = setupServer();
