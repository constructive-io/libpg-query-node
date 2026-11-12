/**
 * DO NOT MODIFY MANUALLY — this is generated from the templates dir
 * 
 * To make changes, edit the files in the templates/ directory and run:
 * npm run copy:templates
 */

// The glue picks Node from `process.versions.node` and a worker from
// `WorkerGlobalScope`, then reads `__dirname` or `self.location` for them.
// Hosts that fake those markers without the rest (Cloudflare Workers with
// `nodejs_compat`, CommonJS bundled into ESM) would throw on the read, before
// `loadModule({ wasm })` can use the bytes it was given.
if (ENVIRONMENT_IS_NODE && typeof __dirname == 'undefined') ENVIRONMENT_IS_NODE = false;
if (ENVIRONMENT_IS_WORKER && !globalThis.self?.location) ENVIRONMENT_IS_WORKER = false;
