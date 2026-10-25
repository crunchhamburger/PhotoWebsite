// Vercel function for the owner-only planner (/planner and /planner/* are rewritten here in
// vercel.json). See api/_lib/planner.js for the security model.
import { createPlannerHandler, configFromEnv, blobStore } from './_lib/planner.js';

let handler;
const handle = (request) => (handler ??= createPlannerHandler({ config: configFromEnv(process.env), store: blobStore() }))(request);

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
