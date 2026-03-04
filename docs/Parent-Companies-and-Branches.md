# Parent Companies and Branches

This document describes how **Parent Companies**, **Subsidiaries**, and **Branches** are modeled and managed in the Invoice Portal.

---

## 1. Overview

The system uses a **hierarchical company structure** with three types:

| Type   | Label       | Role in hierarchy |
|--------|-------------|--------------------|
| **CORP**  | Corporate   | Top-level (parent only). Cannot have a parent. |
| **SUB**   | Subsidiary  | Mid-level. Must have a parent (CORP or another SUB). Can have children (SUB or BRANCH). |
| **BRANCH**| Branch      | Leaf-level. Must have a parent (CORP or SUB). Typically has no children. |

- **Parent company** = any company that can have children: **CORP** or **SUB**.
- **Branches** and **Subsidiaries** always belong to exactly one parent via `parentId`.
- The hierarchy is stored with a **parent reference** (`parentId`) and optional **nested set** indexes (`left`, `right`) for efficient tree queries.

---

## 2. Data Model

### 2.1 Company table (relevant fields)

- **`parentId`** (UUID, nullable) – Parent company. `null` for CORP; required for SUB and BRANCH.
- **`left`** / **`right`** (integer, nullable) – Nested set boundaries; updated in the background when the tree changes.
- **`type`** – `'CORP'` | `'SUB'` | `'BRANCH'`.
- **`name`**, **`referenceNo`**, **`code`**, **`email`**, address, contacts, etc. – standard company attributes.

### 2.2 Associations (Sequelize)

- **Parent/children**: `Company` has many `Company` via `parentId` (`children`); each company belongs to one `Company` (`parent`).
- **On delete**: `onDelete: 'SET NULL'` on the parent association — if a parent is removed, children’s `parentId` is set to `null` (but business rules prevent deleting a company that still has children).

---

## 3. Business Rules

### 3.1 Creating companies

- **CORP**: `parentId` must be `null`. No parent selection.
- **SUB** and **BRANCH**: `parentId` is **required**. Parent must be an existing company with type CORP or SUB.
- **Type** must be one of: `CORP`, `SUB`, `BRANCH`.

### 3.2 Updating companies

- Same rules as create: CORP cannot have a parent; SUB/BRANCH must have a valid parent.
- A company **cannot be its own parent** (`parentId !== company.id`).
- Parent must exist and be CORP or SUB.

### 3.3 Deleting companies

- A company **cannot be deleted if it has any children** (other companies with `parentId` equal to its id).
- Message: *"Cannot delete company with children. Please delete or reassign children first."*
- Delete children (or reassign their `parentId`) before deleting the parent.

### 3.4 Nested set

- After create, update (when `parentId` or structure changes), or delete, a **nested set update** is queued (or run synchronously if no queue).
- This refreshes `left` and `right` for all companies so hierarchy queries (e.g. “all descendants”) remain correct.

---

## 4. API Reference

### 4.1 Parent companies (for dropdowns / selection)

- **`GET /api/companies/parents`**  
  - Returns **paginated** list of companies that can be parents: `type IN ('CORP', 'SUB')` and `isActive: true`.  
  - Query: `page`, `limit`, `search` (name, code, referenceNo).  
  - Used when creating or editing a Branch or Subsidiary to choose the parent.

### 4.2 Full company list (with parent/children)

- **`GET /api/companies`**  
  - Optional query: `type` (e.g. `BRANCH`) or `types` (comma-separated: `CORP,SUB,BRANCH`).  
  - Response includes `parent` and `children` (light attributes).  
  - Used by Companies page and by Branches page when filtering `type === 'BRANCH'`.

### 4.3 Hierarchy (tree)

- **`GET /api/companies/hierarchy`**  
  - Returns companies the user can access, structured as a **tree** (nested `children`).  
  - Respects document-access permissions (`req.accessibleCompanyIds`).  
  - Optional: `search`, `page`, `limit`.

- **`GET /api/companies/:id/hierarchy`**  
  - Returns **all descendants** of the given company (by id).  
  - Uses nested set (`left`/`right`) when present, otherwise recursive load by `parentId`.

### 4.4 Relationships (ancestors + descendants)

- **`GET /api/companies/:id/relationships`**  
  - Returns the company plus its **parent chain** (ancestors) and **descendants** in a nested structure.  
  - Useful for “everything related to this company” views.

### 4.5 Create / update

- **`POST /api/companies`**  
  - Body must include `name`, `referenceNo`, and for SUB/BRANCH a valid `parentId`.  
  - Validates type and parent rules; then queues nested set update.

- **`PUT /api/companies/:id`**  
  - Same parent/type rules; allows changing `parentId` (e.g. moving a branch to another parent).  
  - Queues nested set update when hierarchy changes.

---

## 5. Frontend Usage

### 5.1 Companies page (`/companies`)

- Lists all company types with filters: **Corporate**, **Subsidiary**, **Branch** (and search, status, parent filters).
- Create/edit modal: when type is **SUB** or **BRANCH**, a **Parent Company** selector is shown (searchable; loads from `GET /api/companies/parents` or equivalent).
- Displays parent and type (e.g. badges for CORP / SUB / BRANCH).

### 5.2 Branches page (`/branches`)

- Lists only companies with **`type === 'BRANCH'`** (via `GET /api/companies?type=BRANCH`).
- Add/edit branch: form includes **Parent Company** (CORP or SUB).  
- Parent list is derived from full company list filtered to CORP/SUB, or can use `/api/companies/parents` for search/pagination.

### 5.3 Add Branch page (`/companies/add-branch`)

- Dedicated flow for creating a **BRANCH**.
- **Parent Company** is required; search/pagination via **`GET /api/companies/parents`**.
- Submits to **`POST /api/companies`** with `type: 'BRANCH'` and chosen `parentId`.

### 5.4 Add Subsidiary page (`/companies/add-subsidiary`)

- Same idea as Add Branch but for **SUB**.
- Parent must be CORP or SUB; submits with `type: 'SUB'` and `parentId`.

### 5.5 Hierarchy filter

- **`HierarchicalCompanyFilter`** (e.g. for documents/reports) uses **`GET /api/companies/hierarchy`** to show a tree of companies the user can access (CORP → SUB → BRANCH).

---

## 6. Nested Set (technical)

- **Purpose**: Fast “all descendants” and tree queries without recursive SQL.
- **Storage**: `companies.left` and `companies.right` (integers).
- **Update**: Handled in `backend/utils/nestedSet.js`.  
  - `updateNestedSetIndexes(Company)` recomputes all `left`/`right` from `parentId`.  
  - `queueNestedSetUpdate()` enqueues this job (or runs it synchronously if no queue).
- **When**: Called after company create, update (that changes hierarchy), and delete.

---

## 7. Summary

- **Parent companies** = CORP and SUB; they appear in parent dropdowns and can have SUB/BRANCH children.
- **Branches** = type BRANCH; each has exactly one parent (CORP or SUB), created via Companies page, Branches page, or Add Branch.
- **Subsidiaries** = type SUB; each has one parent (CORP or SUB), can themselves be parents; created via Companies page or Add Subsidiary.
- **Rules**: CORP has no parent; SUB/BRANCH require a valid parent; no self-parent; no deleting a company that has children.
- **APIs**: `/parents` for parent selection, `/hierarchy` for tree, `/:id/hierarchy` for descendants, `/:id/relationships` for full relationship tree.
- **UI**: Companies (all types + parent selector), Branches (BRANCH only), Add Branch, Add Subsidiary, and hierarchical filter all use the above APIs and rules.
