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
// The Statement Generator Sandbox in Settings → Admin Tools also uses the
// same backend but forces silent=true so it never emails customers — it
// stays useful as a smoke-test surface for global_admin regardless of this
// flag. The production feed is the FTP ACR11P .TXT importer.
export const STATEMENTS_ENABLED = true;
