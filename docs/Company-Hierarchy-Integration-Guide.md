# Company hierarchy integration guide (Parent / Branch)

This guide explains **how parent/branch (and subsidiary) hierarchy is wired through** the Invoice Portal so you can reproduce the same patterns in another application. For field-level API and UI page details, see [Parent-Companies-and-Branches.md](./Parent-Companies-and-Branches.md).

---

## 1. What you are integrating

The portal treats every organisation record as a **Company** with:

| Concept | Implementation |
|--------|------------------|
| **Tree shape** | Adjacency list: each row has optional **`parentId`** pointing to its parent company. |
| **Node kinds** | **`type`**: `CORP` (root), `SUB` (subsidiary, can be parent), `BRANCH` (leaf under CORP or SUB). |
| **Fast subtree queries** | Optional **nested set** columns **`left`** and **`right`** on the same table, recomputed whenever the tree changes. |

**Rules (summary):** `CORP` must have `parentId = null`. `SUB` and `BRANCH` must have a parent that exists and is `CORP` or `SUB`. A company cannot be its own parent. You cannot delete a company that still has children (rows with `parentId` = that id).

---

## 2. Data layer

### 2.1 Columns (minimum)

- **`id`** – primary key (this codebase uses UUIDs).
- **`parentId`** – nullable FK to parent company.
- **`type`** – `CORP` | `SUB` | `BRANCH`.
- **`isActive`** – used for parent pickers (only active parents are offered in some flows).

### 2.2 Nested set (recommended for scale)

- **`left`**, **`right`** – integers; define a contiguous interval per subtree so “all descendants of X” is a single range query when indexes are fresh.

**In this repo:** recomputation lives in `backend/utils/nestedSet.js` (`updateNestedSetIndexes`, `queueNestedSetUpdate`). It is triggered after company create/update/delete when hierarchy changes.

### 2.3 ORM associations

Self-referential association: **Company belongsTo Company (as `parent`)** and **Company hasMany Company (as `children`)** on `parentId`. See `backend/models/index.js` and `backend/models/Company.js`.

---

## 3. Backend: hierarchy utilities

**File:** `backend/utils/companyHierarchy.js`

| Function | Purpose |
|----------|---------|
| **`getDescendantCompanyIds(companyId, includeSelf)`** | All descendant IDs under a node. Uses nested set (`left`/`right`) when set; otherwise walks `parentId` recursively. |
| **`hasChildren(companyId)`** | Whether the node has any descendants (for access rules). |
| **`getAccessibleCompanyIds(assignedCompanyIds)`** | Expands a user’s **directly assigned** company IDs using hierarchy (see §4). |

These functions are the main **reusable building blocks** when another portal needs “select parent → include all branches” behaviour.

---

## 4. Backend: how hierarchy affects **who sees what**

**File:** `backend/middleware/documentAccess.js`

After authentication, document routes use **`checkDocumentAccess`**, which:

1. **Global admins / administrators** or users with **`allCompanies`** → `req.accessibleCompanyIds = null` (meaning: no company filter / all companies).
2. Otherwise, loads the user’s assigned companies and sets:

   **`req.accessibleCompanyIds = await getAccessibleCompanyIds(assignedIds)`**

**Semantics:**

- If the user is assigned to a company **that has children** (parent/subsidiary in practice), they can see documents for **that company and every descendant** (e.g. all branches under a CORP they’re tied to).
- If the user is assigned to a **leaf** (typically a branch), they only see **that** company.

List endpoints then merge this with `buildCompanyFilter(req.accessibleCompanyIds)` so queries restrict `companyId` to allowed IDs.

**Takeaway for another portal:** decide whether assignment at a parent should imply visibility to children; this codebase answers **yes**, implemented via `getAccessibleCompanyIds`.

---

## 5. Backend: how hierarchy affects **filters** (parent selection → include branches)

Even when a user is allowed to see many companies, the UI often lets them **narrow** by one or more companies. If they pick a **parent**, document lists should usually include **all underlying branches**.

**Pattern in this repo:** when `companyId` or `companyIds` query params are present, the API **expands** each id with `getDescendantCompanyIds` before applying the filter.

**Example:** `backend/routes/invoices.js` (same idea exists in credit notes and statements routes):

- Start from `buildCompanyFilter(req.accessibleCompanyIds)`.
- If the client passes `companyId` / `companyIds`, replace the filter with `companyId IN (selected ∪ all descendants per selected id)`.

So: **accessible set** = what the user may see; **filter expansion** = treat “pick parent” as “parent + subtree” for that query.

---

## 6. HTTP API surface (for another portal’s BFF or SPA)

All under authenticated **`/api/companies`** (see `backend/routes/companies.js`).

| Endpoint | Role in hierarchy integration |
|----------|-------------------------------|
| **`GET /api/companies/parents`** | Paginated searchable list of companies that may be parents: active `CORP` and `SUB`. Used for parent pickers when creating/editing `SUB`/`BRANCH`. |
| **`GET /api/companies/hierarchy`** | Tree of companies the user may access (uses `checkDocumentAccess`); supports `search`, `page`, `limit`. |
| **`GET /api/companies`** | Flat list with `parent` / `children` includes; filter by `type` or `types`. |
| **`GET /api/companies/:id/hierarchy`** | Descendants of one node (nested set or recursive fallback). |
| **`GET /api/companies/:id/relationships`** | Ancestors + descendants for relationship views. |
| **`POST /api/companies`**, **`PUT /api/companies/:id`** | Create/update with `type` + `parentId` validation; queue nested set refresh when the tree changes. |

Create/update **validation** (parent required for SUB/BRANCH, forbidden for CORP, parent must be CORP/SUB, no self-parent) is implemented in the same route module.

---

## 7. Frontend patterns in this repo

| Piece | Location | Behaviour |
|-------|----------|-----------|
| **Tree filter modal (fetches API)** | `frontend/src/components/HierarchicalCompanyFilter.js` | Calls **`GET /api/companies/hierarchy`** with pagination/search; user selects companies; parent/child UI is tree-based. |
| **Tree from preloaded list** | `frontend/src/components/CompanyHierarchyFilter.js` | Builds a tree in the client from a `companies` array (`parentId` + roots = `CORP` or no parent). |
| **CRUD + parent selector** | `frontend/src/pages/Companies.js` | Type switch clears `parentId` for CORP; SUB/BRANCH require parent selection. |
| **Branch-only screens** | `frontend/src/pages/Branches.js`, `frontend/src/pages/AddBranch.js` | `type: 'BRANCH'` + `parentId` from parents API or list. |
| **Subsidiary flow** | `frontend/src/pages/AddSubsidiary.js` | Same as branch but `type: 'SUB'`. |

**Routing** (for reference): `frontend/src/App.js` registers `/companies`, `/branches`, `/companies/add-branch`, `/companies/add-subsidiary`.

---

## 8. Checklist to port to another portal

1. **Schema:** `parentId`, `type` (or equivalent), optional `left`/`right`, indexes on `parentId` and nested set columns if used.
2. **Invariants:** enforce CORP vs SUB/BRANCH parent rules on write; block delete when children exist.
3. **Subtree queries:** implement `getDescendantCompanyIds` (nested set + recursive fallback).
4. **Nested set maintenance:** recompute `left`/`right` after any structural change, or accept slower recursive queries until indexes exist.
5. **Authorisation:** decide if “assigned to parent” implies access to descendants; if yes, mirror `getAccessibleCompanyIds` + middleware.
6. **Filters:** when the user picks a parent company in the UI, expand to descendants on the server (or client, if datasets are small and security is already enforced server-side).
7. **APIs:** parent picker endpoint, hierarchy/tree endpoint, and standard CRUD with includes for `parent` / `children`.
8. **UI:** parent autocomplete or tree; separate flows optional for “add branch” / “add subsidiary” vs single company form.

---

## 9. Related documentation

- [Parent-Companies-and-Branches.md](./Parent-Companies-and-Branches.md) – full domain and API reference for this project.
- Code anchors: `backend/models/Company.js`, `backend/utils/nestedSet.js`, `backend/utils/companyHierarchy.js`, `backend/middleware/documentAccess.js`, `backend/routes/companies.js`, `backend/routes/invoices.js` (company filter expansion).

---

*This guide is written to be copied or adapted for another portal’s technical design; replace file paths with your target codebase as needed.*
