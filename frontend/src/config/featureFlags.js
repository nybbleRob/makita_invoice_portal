/**
 * Frontend feature flags. Flip a flag off to hide a whole product area
 * from the customer-facing UI (nav + routes) without touching the backend,
 * DB schema, or worker code, so a re-enable is a one-line change and a
 * rebuild.
 *
 * These are compile-time constants intentionally — no runtime toggle from
 * Settings — because the areas they gate are pre-production and we don't
 * want a stray admin click to expose them.
 */

// Customer-facing Statements (list, view, edit, uploads, imports).
// The Statement Generator Sandbox in Settings → Admin Tools remains visible
// to global_admin regardless of this flag; it calls the same backend routes
// (which stay online) and is intended for internal test runs only.
export const STATEMENTS_ENABLED = false;
