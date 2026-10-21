// Vercel function for the owner-only research view (/research/* is rewritten here in vercel.json).
// The rest of the site is static; see api/_lib/handler.js for the security model.
import { createHandler, configFromEnv } from './_lib/handler.js';

let handler;
const handle = (request) => (handler ??= createHandler({ config: configFromEnv(process.env) }))(request);

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
