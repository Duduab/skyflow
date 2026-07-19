# SkyFlow API — Backend Architecture

> **SkyFlow MES** (Manufacturing Execution System) backend for an aluminum/steel curtain‑wall & window fabrication plant.
> This document is the single, authoritative technical reference for the `/api` service: architecture, data model, flows, and HTTP interfaces.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Layout](#3-project-layout)
4. [Application Bootstrap & Global Configuration](#4-application-bootstrap--global-configuration)
5. [Authentication, Authorization & Security](#5-authentication-authorization--security)
6. [Domain Model (Glossary)](#6-domain-model-glossary)
7. [The Manufacturing Stations](#7-the-manufacturing-stations)
8. [End‑to‑End Project Lifecycle](#8-end-to-end-project-lifecycle)
9. [Modules Reference](#9-modules-reference)
10. [Complete HTTP API Reference](#10-complete-http-api-reference)
11. [Data Model (Prisma Schema)](#11-data-model-prisma-schema)
12. [File Storage & Static Assets](#12-file-storage--static-assets)
13. [External Integrations](#13-external-integrations)
14. [Configuration (Environment Variables)](#14-configuration-environment-variables)
15. [Build, Run, Migrate & Deploy](#15-build-run-migrate--deploy)
16. [Cross‑Cutting Conventions](#16-cross-cutting-conventions)

---

## 1. Overview

SkyFlow tracks a fabrication project ("order") through its full life:

```
Planning (תפ״י)  ──►  Production floor (stations 1–8)  ──►  Packing & delivery notes  ──►  On‑site installation
```

The backend is a **NestJS 11** monolith exposing a REST API under the global prefix **`/api`**. It persists to **PostgreSQL** via **Prisma**, uses **JWT** bearer authentication with **role‑based** authorization, and integrates with **Anthropic Claude Vision** (PDF/drawing parsing) and **AWS S3** (purchase‑order document backup). Uploaded files are written to the sibling web app's `public/` folder so the Angular frontend can serve them as static assets.

Two production‑tracking models coexist:

- **Legacy / project‑level:** progress is derived from aggregated `StationLog` totals per station.
- **Work Cycles (current):** one production run per *window type*, each moving through the station chain independently, completed via the elevation (facade) map.

Completion logic prefers Work Cycles when they exist, and falls back to legacy station totals otherwise.

---

## 2. Technology Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js (TypeScript, ES2023, `nodenext` modules) |
| Framework | NestJS 11 (`@nestjs/common`, `/core`, `/platform-express`) |
| ORM / DB | Prisma 6 + PostgreSQL |
| Auth | `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `bcrypt` |
| Validation | `class-validator`, `class-transformer` (global `ValidationPipe`) |
| File uploads | `multer` (via `@nestjs/platform-express` `FileInterceptor`) |
| PDF parsing | `pdf-parse`, custom `pdfjs` + `@napi-rs/canvas` renderers |
| PDF generation | `pdfkit` (delivery notes, RTL Hebrew) |
| Spreadsheets | `xlsx` (legacy Excel planning) |
| AI Vision | `@anthropic-ai/sdk` (Claude) |
| Object storage | `@aws-sdk/client-s3` + `s3-request-presigner` |
| Email | `nodemailer` (SMTP) with `mailto:` fallback |
| Archives | `jszip` |
| Testing | Jest + `ts-jest`, `supertest` (e2e) |

---

## 3. Project Layout

```
api/
├── src/
│   ├── main.ts                     # Bootstrap: global prefix, CORS, ValidationPipe
│   ├── app.module.ts               # Root module; registers global JwtAuthGuard
│   ├── health.controller.ts        # Public GET /api/health
│   ├── prisma/                     # PrismaService + module (lazy connect)
│   ├── auth/                       # Login, JWT strategy/guard, roles, @Public/@Roles
│   ├── users/                      # Users CRUD, daily targets, performance
│   ├── orders/                     # Read-only project/order queries + station totals
│   ├── projects/                   # Planning wizard, 4-PDF flow, approve/complete
│   ├── planning/                   # PDF/Excel parsers, Claude vision, media persistence
│   ├── stations/                   # Worker terminal context + station reporting
│   ├── work-cycles/                # Per-window-type production runs
│   ├── tracking/                   # Manager production/supply/install board
│   ├── elevation/                  # Facade maps, cell marking, defect returns
│   ├── delivery-notes/             # Station-6 delivery note issuance (PDF)
│   ├── shipping/                   # "Ready to ship" summary
│   ├── admin/                      # Dashboards, scrap, simulation, delivery notes
│   ├── pdf-analysis/               # Purchase-order BOM extraction (Claude + S3)
│   ├── mail/                       # SMTP email service
│   └── common/                     # Shared pure utils (no Nest DI)
├── prisma/
│   ├── schema.prisma               # Data model (source of truth)
│   ├── migrations/                 # 36 migrations
│   ├── seed.ts / seed-demo-worker.ts
├── scripts/                        # DB bootstrap, render pre-deploy, re-analyze tools
├── assets/                         # Bundled runtime assets (e.g. Hebrew font)
├── storage/                        # Runtime storage (e.g. elevation-maps/)
└── nest-cli.json, tsconfig*.json, package.json
```

**Module import convention:** relative imports frequently use the `.js` suffix (required by `nodenext` module resolution for compiled output). Prisma‑generated types are imported from `@prisma/client`.

---

## 4. Application Bootstrap & Global Configuration

`src/main.ts`:

- **Global prefix:** every route is served under **`/api`** (e.g. `POST /api/auth/login`).
- **CORS:** allows any `localhost:<port>` and `127.0.0.1:<port>` origin, plus comma‑separated origins from `CORS_ORIGINS`. `credentials: true`.
- **Global `ValidationPipe`:**
  - `whitelist: true` — strips unknown properties.
  - `forbidNonWhitelisted: true` — **rejects** requests containing unknown properties.
  - `transform: true` + `enableImplicitConversion: true` — DTO types are coerced (e.g. numeric query/body strings → numbers).
- **Port:** `PORT` env or `3000`.

`src/app.module.ts`:

- `ConfigModule.forRoot({ isGlobal: true })` — env available everywhere.
- Registers a **global** `APP_GUARD` = `JwtAuthGuard` → **every endpoint requires JWT by default** unless decorated `@Public()`.
- Imports all feature modules: Prisma, Auth, Users, Orders, Stations, Admin, Shipping, Projects, PdfAnalysis, Elevation, WorkCycles, Tracking.

`PrismaService` connects **lazily** (on first query) so the app can boot even while Postgres is still starting or credentials are being fixed.

---

## 5. Authentication, Authorization & Security

### 5.1 Authentication

- **Login:** `POST /api/auth/login` (`@Public()`) with `{ email, password }`.
  - Email is normalized (`trim().toLowerCase()`).
  - Password checked with `bcrypt.compare` against `User.passwordHash`.
  - On success returns `{ access_token, user: PublicUser }`.
- **JWT payload:** `{ sub: userId, email, role }`. `role` is stored as a plain string to avoid Prisma↔JWT enum mismatches.
- **Strategy:** `passport-jwt` extracts a Bearer token from the `Authorization` header, verifies with `JWT_SECRET` (default dev fallback), and attaches `req.user = { userId, email, role }`.

### 5.2 Authorization

- **`JwtAuthGuard`** (global): enforces a valid token on all routes except those marked `@Public()`.
- **`RolesGuard`** (per controller/handler, via `@UseGuards(RolesGuard)`): checks `req.user.role` against `@Roles(...)` metadata. If no roles are required, access is allowed (auth still enforced by the global guard).
- **`@Public()`** / **`@Roles(...)`** decorators set metadata read by the guards.

### 5.3 Roles (`SkyflowRole`)

| Role | Purpose |
|---|---|
| `WORKER` | Floor operator; reports station progress. |
| `STATION_MANAGER` | Manages a specific station (`managedStationId` 1–7). |
| `SITE_MANAGER` | On‑site installation manager; also project manager for tracking. |
| `PLANNING` | תפ״י planner: uploads planning files, previews, approves to production. |
| `ADMIN` | Full access: dashboards, users, scrap, delivery notes, simulation. |

### 5.4 Notable in‑handler security rules

- **Station 7 reporting** requires `SITE_MANAGER` role.
- **Delivery note issuance** requires `ADMIN` or `STATION_MANAGER` bound to station 6.
- **Elevation cell edits/defects** require `ADMIN` or `SITE_MANAGER` (with `managedStationId` null or 7).
- **Tracking board** allows `ADMIN`/`PLANNING` always; `SITE_MANAGER` only for projects they manage (or unassigned projects).
- **Public static‑asset controllers** (`elevation-maps`, `planning-imports`) validate the `mapId`/`projectId` as a UUID and the filename against strict regexes before streaming files.

---

## 6. Domain Model (Glossary)

| Term | Meaning |
|---|---|
| **ProjectOrder** | A fabrication project/order. Central aggregate root. |
| **flowStatus** | `PENDING_PLANNING` → `IN_PRODUCTION` → `COMPLETED`. |
| **lineMaterial** | `ALUMINUM` (station 1 = Saws) or `STEEL` (station 1 = Steel workshop / מסגריה). |
| **machiningRoute** | `GLASS` (station 2 = CNC) or `ALU_RANGER` (station 2 = Alu Ranger). |
| **angleSourcing** | `INTERNAL_LASER` (station 8 laser used), `EXTERNAL_SUPPLIER`, or `NO_LASER`. |
| **WindowType** | A unit type, e.g. `74-1-03A`. The hub connecting quantities ↔ instructions ↔ facade map. |
| **Facade** | A sub‑elevation (`S-w`, `N2-e`, `W4`). Belongs to a `groupKey` (`S`, `N2`, `W`) and a Stage. |
| **ProductionStage** | Time‑zone stage (A/B/C…) from the quantities file, color‑coded. |
| **FacadeQuantity / StageQuantity** | How many of a window type appear in a facade / stage. |
| **Angle (ANG)** | An angle sub‑part (`ANG-1A`), produced at the laser station. |
| **WorkCycle** | A 1:1 production run per window type; travels through the station chain. |
| **StationLog** | Append‑only progress record per station visit/batch (holds JSON snapshots). |
| **ScrapReport** | Offcut/scrap record per station, keyed by profile code + length. |
| **ProjectDocument** | A PDF attached to a project (quantities, instructions, angles, connection details, elevation, purchase/work order). |
| **ElevationMap / ElevationCell** | Rendered facade map + clickable per‑unit cells for install tracking. |
| **CellDefect** | A defect that returns a unit to a specific station for rework. |
| **ProjectDeliveryNote** | Delivery note issued at packing (station 6), with a generated PDF. |
| **ModuleTrackingRow / Beat** | Manager's digital replica of the Excel tracking board (production/supply/install). |
| **SawStationWorkLine** | Cut line for the saws station (legacy Excel flow). |
| **SteelworkDetail** | Connection‑details appendix for steel projects (virtual station 9). |

---

## 7. The Manufacturing Stations

Station IDs run **1–9**. Stations **1–7** are the linear production line; **8** is a conditional parallel station; **9** is virtual (no worker card).

| ID | Default (Hebrew) | English | Purpose |
|---|---|---|---|
| 1 | מסורים / מסגריה | Saws / Steel workshop | Profile cutting (ALUMINUM) or steel fabrication (STEEL). Requires `cutLength` on logs. |
| 2 | CNC / Alu Ranger | CNC / Alu Ranger | Machining of cut profiles. Name depends on `machiningRoute`. |
| 3 | הרכבה | Assembly | Window assembly, TYPE reports (+photo), parts checklist, per‑window qty. |
| 4 | הדבקות | Glazing / Gluing | Gluing by instruction TYPE; locked until CNC done for that TYPE. |
| 5 | פינישים | Finishes | Binary completion (≥1 log = done). |
| 6 | אריזה | Packing | Pack photos + delivery note issuance. |
| 7 | הרכבה באתר | On‑site assembly | Install progress (beams / glazing / unitized). `SITE_MANAGER` only. |
| 8 | תחנת לייזר | Laser station | Conditional — cuts `Angle` (ANG) parts. Only for `INTERNAL_LASER`. |
| 9 | (virtual) | Steelwork | Connection‑details reports for steel projects; kept out of station‑1 saw totals. |

**Presentation logic:** station display name/variant is resolved by `lineMaterial`, `machiningRoute`, and `angleSourcing`. The web client's worker flow order becomes `[1,2,8,3,4,5,6,7]` when the laser station is active, otherwise `[1,2,3,4,5,6,7]`; the displayed station number is the position in this sequence, not the raw ID.

**Constants:** `MIN_STATION = 1`, `MAX_STATION = 9`, `LASER_STATION_ID = 8`, `STEELWORK_STATION_ID = 9`.

### Per‑station progress (legacy model)

| Station | % complete formula |
|---|---|
| 1 | `done / totalItems` |
| 2–4 | `done / qty(previous station)` |
| 5 | `100%` if `done ≥ 1`, else `0%` |
| 6 | `done / totalItems` |
| 7 | Average of beams/glazing/unitized ratios; **0%** if no delivery note exists |
| 8 | `done / sum(Angle.qty)`; `100%` if no target |

A legacy project is *production‑complete* when every applicable station is ≥ 100% (station 8 counts only when the laser is required, i.e. `INTERNAL_LASER` + at least one `Angle` with qty > 0).

---

## 8. End‑to‑End Project Lifecycle

### Phase A — Planning draft (`PENDING_PLANNING`)

1. `PLANNING`/`ADMIN` creates a draft (`POST /api/projects`) with `name`, `lineMaterial`, `machiningRoute`, `angleSourcing`, optional project manager (must be a `SITE_MANAGER`).
2. Draft starts empty (`totalItems: 0`). The wizard tracks progress in steps (step 2 = created; step 3 = has parsed data).

### Phase B — The "4‑PDF" flow (current planning path)

The planner uploads up to four PDF kinds; each is parsed into the relational model. Uploads are allowed while `PENDING_PLANNING` **or** `IN_PRODUCTION` (a `COMPLETED` project is frozen).

| PDF kind | Parsing | Produces |
|---|---|---|
| `QUANTITIES_PDF` | Text + fill‑color sampling | `WindowType`, `Facade`, `FacadeQuantity`, `ProductionStage`, `StageQuantity`, and `WorkCycle` (DRAFT) per type |
| `WINDOW_INSTRUCTION_PDF` | Text + **Claude Vision** | Enriches `WindowType` (composition, sets, angle codes, `partsPayload`, glass panels); stub `Angle` rows; syncs cycle stations |
| `ANGLE_INSTRUCTION_PDF` | Text extraction | `Angle` quantities + instruction doc link |
| `CONNECTION_DETAILS_PDF` | None (view‑only) | `SteelworkDetail` (project‑level) or `WindowType.connectionDocId` (per type) |

Plus **elevation maps** (`ELEVATION_MAP`) uploaded **per facade group** (`S`, `N5`, `W2`…) → rendered to `ElevationMap` + `ElevationCell`, linked to window types by code.

The planner may correct Vision OCR of parts via `POST .../window-types/:id/parts` before workers see them.

### Phase C — Approve planning (`IN_PRODUCTION`)

`POST /api/projects/:id/approve-planning`:

- Requires at least one `WindowType` (4‑PDF path) or `ProductItem` (legacy Excel path).
- Sets `flowStatus = IN_PRODUCTION`, `status = IN_PROGRESS`, and `totalItems = max(1, Σ WindowType.totalQty)`.
- Persists saws staffing (single assignee, or team mode with `sawsWorkerUserIds` + a station‑1 manager) and syncs station‑1 daily targets.
- **4‑PDF path** deletes any `SawStationWorkLine` (not used) and does **not** open work cycles — cycles stay `DRAFT` until launched.
- **Legacy Excel path** builds `SawStationWorkLine` rows from product components and copies planning workbook images to the web app's public folder.

### Phase D — Production via Work Cycles

- **Launch:** `POST /api/projects/:id/work-cycles/:cycleId/launch` sets assignments + daily target, requires the window type to have an instruction doc, moves the cycle `DRAFT → OPEN`, and promotes the project to production.
- **Report:** workers pull the cycles waiting at their station and report quantity; the cycle advances `currentStationId` to the first station that still has remaining work, and status becomes `IN_PROGRESS`. Each report also writes a linked `StationLog`.
- **Complete:** a cycle becomes `COMPLETED` only when **all its elevation‑map cells are marked DONE** (not when stations finish). Un‑marking a cell reverts it to `IN_PROGRESS`.
- **Return:** a defect reported on the facade map sets the cycle `RETURNED` with `returnedFromStationId` + `returnReason` and re‑opens the cell.

Cycle lifecycle: `DRAFT → OPEN → IN_PROGRESS → COMPLETED` (or `RETURNED`, which can re‑open to `OPEN`).

### Phase E — Packing & delivery (station 6)

1. Worker uploads pack photos (required slots = 3). When complete, an auto `StationLog` records remaining pack quantity.
2. Delivery note is issued (`POST /api/stations/6/delivery-note/issue`): selects line items (window units), picks `INTERNAL`/`EXTERNAL` shipping (+ price), generates a **pdfkit** PDF, numbers it `DN-YYYY-<projId6>-NNN`, and updates the project's site‑assembly expectations.
3. Site managers (`managedStationId = 7`) are notified by email when SMTP is configured.

### Phase F — On‑site installation & tracking

- Station 7 requires an **active delivery note** and records assembled beams/glazing/unitized.
- The **elevation map** lets the site/project manager mark units DONE (driving cycle completion) or report defects (returning units to a station).
- The **tracking board** (`ModuleTrackingRow`/`Beat`) mirrors the manager's Excel: rows auto‑generated from `FacadeQuantity`, with dated beats per phase (PRODUCTION/SUPPLY/INSTALL).

### Phase G — Complete (`COMPLETED`)

`POST /api/projects/:id/complete`:

- If work cycles exist → all must be `COMPLETED`.
- Otherwise (legacy) → all applicable stations at 100%.
- Sets `flowStatus = COMPLETED`, `status = COMPLETED`. `GET .../can-complete` is the non‑throwing UI gate.

---

## 9. Modules Reference

Each Nest module = controller(s) + service(s) + DTOs. All import `PrismaModule`.

### Auth (`auth/`)
Login, JWT issuance/verification, guards (`JwtAuthGuard`, `RolesGuard`) and decorators (`@Public`, `@Roles`). `AuthService.toPublic()` strips `passwordHash` into `PublicUser`.

### Users (`users/`)
- CRUD (ADMIN‑only), password hashing (bcrypt cost 10), role↔`managedStationId` binding (only for `STATION_MANAGER`/`SITE_MANAGER`, 1–7).
- Lookups for planning: `stationManagers`, `planningAssignees`, `siteManagers`.
- **Performance** analytics per worker (`getPerformance`): totals, today/yesterday, weekly pace vs plant average, estimated active hours, per‑station breakdown, recent activity.
- **Daily targets**: `MANUAL` (minutes‑based) and `PLANNING` (qty/line‑item based, auto‑created on approval by `DailyTargetPlanningService`). `getTodayTargetAlerts` flags workers `warning` (<80%) or `missed` (<100% after 16:00 local).

### Orders (`orders/`)
Read‑only. `findAll`, `findOne`, `stationTotals` (sum of `processedQty` per station), `qtyAtStation`, `scrapTotals`.

### Projects (`projects/`)
The planning wizard + lifecycle: create/update/delete drafts, ingest the 4 planning PDFs, per‑window‑type PDFs, facade‑group elevation, previews, parts save, approve/complete, generic document upload, and document email.

### Planning (`planning/`)
Not exposed as a business controller (except the public `planning-imports` asset controller). Contains:
- `WindowPlanningService` — orchestrates PDF parse + persist + Claude Vision.
- Parsers: `quantities-pdf.parser`, `window-instructions-pdf.parser`, `angle-pdf.parser`, `planning-excel.parser`.
- Vision: `window-parts-vision` (Hebrew set tables → `partsPayload`), `window-glass-vision` (WM/GM glass panels), `window-angle-vision` (ANG codes).
- Media persistence: workbook/assembly/glass image extraction and serving.

### Stations (`stations/`)
The worker terminal backend. `getWorkerContext(projectId, stationId)` assembles everything a station needs. Reporting endpoints for generic logs, scrap, pack photos, assembly qty/parts/type report, gluing, work‑cycle reporting, and delivery‑note preview/issue.

### Work Cycles (`work-cycles/`)
Per‑window‑type runs: list/get, set assignments, set daily target, launch, and worker reporting. Bridges to elevation for completion/return.

### Tracking (`tracking/`)
Manager board: generate rows from planning quantities, add/delete beats, edit notes. Computes per‑phase progress and project/stage summaries. Role‑scoped to the assigned project manager.

### Elevation (`elevation/`)
Facade maps: get (per group), mark cells done/pending, report defect (return to station), list/resolve defects. `elevation-render.ts` uses pdfjs + canvas to detect gray (SPANDREL) / cyan (UNIT) cells and window‑type codes. `elevation-assets.controller` streams rendered PNGs publicly.

### Delivery Notes (`delivery-notes/`)
Preview, issue (with PDF via pdfkit), admin list/update/cancel. Handles numbering, partial shipments, internal/external pricing, site‑assembly expectation sync, and site‑manager email notification.

### Shipping (`shipping/`)
`getReadyToShip` — projects whose station‑6 packed qty ≥ `totalItems`.

### Admin (`admin/`)
Dashboards (`getDashboard`), project activity, scrap overview, order simulation snapshot, and admin delivery‑note management.

### PDF Analysis (`pdf-analysis/`)
Purchase‑order BOM extraction: render PDF, extract via deterministic grid or Claude Vision, back up to S3, save `ManufacturingPlan`, and issue presigned drawing preview URLs. Requires Anthropic + AWS config or returns `503`.

### Mail (`mail/`)
`MailService` sends PDFs via nodemailer when SMTP is configured; otherwise callers fall back to `mailto:` links.

### Common (`common/`)
Pure utilities (no DI): assembly/gluing context builders, window‑parts normalization, station presentation names, site‑assembly math, station‑completion math, delivery‑note PDF + line‑item logic, pack‑photo constants, profile/scrap inventory & simulation.

---

## 10. Complete HTTP API Reference

All routes are prefixed with **`/api`**. Unless noted `@Public()`, a valid **Bearer JWT** is required. Role restrictions from `@Roles(...)` are shown in the **Roles** column (blank = any authenticated user).

### Auth

| Method | Path | Roles | Body / Notes |
|---|---|---|---|
| POST | `/auth/login` | Public | `{ email, password }` → `{ access_token, user }` |

### Health

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/health` | Public | `{ ok: true, service }` |

### Users (`@Roles(ADMIN)` on controller; overrides noted)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/users` | ADMIN | List `PublicUser[]` |
| GET | `/users/station-managers` | WORKER, STATION_MANAGER, SITE_MANAGER, ADMIN, PLANNING | Map keyed by station ID |
| GET | `/users/planning-assignees` | ADMIN, PLANNING | Workers + station‑1 managers |
| GET | `/users/site-managers` | ADMIN, PLANNING | |
| GET | `/users/daily-targets/today-alerts` | ADMIN | Behind‑target alerts |
| GET | `/users/:id/performance` | ADMIN | Worker performance analytics |
| GET | `/users/:id/daily-targets` | ADMIN | History + today snapshot |
| POST | `/users/:id/daily-targets` | ADMIN | `CreateUserDailyTargetDto` |
| POST | `/users` | ADMIN | `CreateUserDto` |
| PATCH | `/users/:id` | ADMIN | `UpdateUserDto` |

### Orders (`@Roles` all business roles)

| Method | Path | Notes |
|---|---|---|
| GET | `/orders` | All orders (`updatedAt desc`) |
| GET | `/orders/:id/stations` | Station totals |
| GET | `/orders/:id` | Single order (404 if missing) |

### Projects (`@UseGuards(RolesGuard)`; per‑route roles)

| Method | Path | Roles | Body |
|---|---|---|---|
| GET | `/projects/planning/list` | ADMIN, PLANNING | Drafts only |
| POST | `/projects` | ADMIN, PLANNING | `CreatePlanningDraftDto` |
| PATCH | `/projects/planning/:id` | ADMIN, PLANNING | `UpdatePlanningDraftDto` |
| DELETE | `/projects/planning/:id` | ADMIN, PLANNING | Delete draft |
| POST | `/projects/documents/:documentId/send-email` | ADMIN | `SendProjectDocumentEmailDto` |
| POST | `/projects/:id/documents` | ADMIN | multipart `file` (PDF) + `UploadProjectDocumentDto` |
| POST | `/projects/:id/planning/upload` | ADMIN, PLANNING | **@deprecated** legacy Excel/CSV (`file`) |
| GET | `/projects/:id/planning/preview` | ADMIN, PLANNING | **@deprecated** Excel preview |
| POST | `/projects/:id/planning/pdf` | ADMIN, PLANNING | multipart `file` + `UploadPlanningPdfDto` (4‑PDF flow) |
| POST | `/projects/:id/planning/window-types/:windowTypeId/pdf` | ADMIN, PLANNING | `file` + `UploadWindowTypePdfDto` |
| POST | `/projects/:id/planning/facade-groups/:groupKey/elevation` | ADMIN, PLANNING | `file` (elevation PDF) |
| GET | `/projects/:id/planning/pdf-preview` | ADMIN, PLANNING | Aggregated preview |
| POST | `/projects/:id/planning/window-types/:windowTypeId/parts` | ADMIN, PLANNING | `SaveWindowTypePartsDto` |
| GET | `/projects/:id/planning/resume` | ADMIN, PLANNING | Resume wizard item |
| POST | `/projects/:id/approve-planning` | ADMIN, PLANNING | `ApprovePlanningDto` |
| POST | `/projects/:id/complete` | ADMIN | Complete project |
| GET | `/projects/:id/can-complete` | ADMIN | `{ canComplete }` |

### Stations (`@Roles` all business roles)

| Method | Path | Notes |
|---|---|---|
| GET | `/stations/:stationId/context/:projectId` | Full worker context for a station |
| GET | `/stations/project-cycles/:projectId` | All launched work cycles (unit picker) |
| GET | `/stations/:stationId/work-cycles/:projectId` | Cycles waiting at this station |
| POST | `/stations/:stationId/work-cycles/:cycleId/report` | `ReportCycleProgressDto` |
| POST | `/stations/:stationId/logs` | `CreateStationLogDto` (station 7 ⇒ SITE_MANAGER) |
| POST | `/stations/3/assembly-window-qty` | `SetAssemblyWindowQtyDto` |
| POST | `/stations/3/assembly-parts-check` | `SaveAssemblyPartsCheckDto` |
| POST | `/stations/3/assembly-type-report` | multipart `file` + query `projectId`, `instructionKind` |
| POST | `/stations/4/gluing-type` | `SetGluingTypeDoneDto` |
| POST | `/stations/:stationId/scrap` | `CreateScrapReportDto` |
| GET | `/stations/6/delivery-note/preview` | query `projectId` |
| POST | `/stations/6/delivery-note/issue` | `IssueDeliveryNoteDto` (ADMIN or station‑6 manager) |
| POST | `/stations/:stationId/delivery-note` | **@deprecated** (station 7) — returns error |
| POST | `/stations/:stationId/pack-photo` | multipart `file` + query `projectId`, `slotIndex` (station 6) |

### Work Cycles (`/projects/:projectId/work-cycles`)

| Method | Path | Roles | Body |
|---|---|---|---|
| GET | `/` | ADMIN, PLANNING | List cycles |
| GET | `/:cycleId` | ADMIN, PLANNING | Single cycle |
| POST | `/:cycleId/assignments` | ADMIN, PLANNING | `SetWorkCycleAssignmentsDto` |
| POST | `/:cycleId/daily-target` | ADMIN, PLANNING | `SetWorkCycleDailyTargetDto` |
| POST | `/:cycleId/launch` | ADMIN, PLANNING | `LaunchWorkCycleDto` |

### Tracking (`/projects/:projectId/tracking`, `@Roles(ADMIN, PLANNING, SITE_MANAGER)`)

| Method | Path | Body |
|---|---|---|
| GET | `/` | Full tracking board |
| POST | `/generate` | Regenerate rows from quantities |
| POST | `/rows/:rowId/beats` | `AddTrackingBeatDto` |
| DELETE | `/beats/:beatId` | Delete beat |
| PATCH | `/rows/:rowId/notes` | `UpdateRowNotesDto` |

### Elevation (`/projects/:projectId/elevation-map`, JWT‑guarded)

| Method | Path | Body / Notes |
|---|---|---|
| GET | `/` | query `group` (facade group) |
| POST | `/cells/mark` | `MarkCellsDto` (ADMIN / SITE_MANAGER) |
| POST | `/cells/defect` | `ReportDefectDto` (ADMIN / SITE_MANAGER) |
| GET | `/defects/station/:stationId` | Open rework queue for a station |
| POST | `/defects/:defectId/resolve` | Resolve a defect |

### Elevation assets (public)

| Method | Path | Notes |
|---|---|---|
| GET | `/elevation-maps/:mapId/:filename` | Public; UUID + `page-N.png` validated; streams PNG |

### Planning import assets (public)

| Method | Path | Notes |
|---|---|---|
| GET | `/planning-imports/:projectId/:filename` | Public; UUID + safe filename; streams image |

### Delivery Notes / Admin (`/admin`, `@UseGuards(RolesGuard)`)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/admin/dashboard` | ADMIN, PLANNING | query `projectId` (optional scope) |
| GET | `/admin/projects/:projectId/activity` | ADMIN, PLANNING | `no-store` |
| GET | `/admin/scrap` | ADMIN | Scrap overview |
| GET | `/admin/simulation` | ADMIN | Profile inventory / material gap |
| GET | `/admin/delivery-notes` | ADMIN | query `projectId` |
| PATCH | `/admin/delivery-notes/:id` | ADMIN | `UpdateDeliveryNoteDto` |
| POST | `/admin/delivery-notes/:id/cancel` | ADMIN | Cancel note |

### Shipping (`@Roles(ADMIN)`)

| Method | Path | Notes |
|---|---|---|
| GET | `/shipping/ready` | Projects ready to ship |

### PDF Analysis (`@UseGuards(JwtAuthGuard)`)

| Method | Path | Notes |
|---|---|---|
| POST | `/pdf-analysis/upload` | multipart `file` (PDF) → BOM preview (no persist) |
| POST | `/pdf-analysis/drawing-preview` | `DrawingPreviewDto` → presigned S3 URL |
| POST | `/pdf-analysis/orders` | `SavePurchaseOrderDto` → persist `ManufacturingPlan` |
| GET | `/pdf-analysis/orders` | List saved purchase orders |

---

### Key request DTOs (validated interfaces)

```ts
// auth/dto/login.dto.ts
LoginDto { email: string /*IsEmail*/; password: string /*len≥1*/ }

// projects/dto/create-planning-draft.dto.ts
CreatePlanningDraftDto {
  name: string;                 // 2–200
  requirements?: string;        // ≤4000
  lineMaterial: ProjectLineMaterial;      // ALUMINUM | STEEL
  machiningRoute: ProjectMachiningRoute;  // GLASS | ALU_RANGER
  angleSourcing?: ProjectAngleSourcing;   // INTERNAL_LASER | EXTERNAL_SUPPLIER | NO_LASER
  projectManagerUserId?: string | null;   // must be SITE_MANAGER
}

// projects/dto/upload-planning-pdf.dto.ts
UploadPlanningPdfDto {
  kind: ProjectDocumentKind;    // one of the planning PDF kinds
  title?: string;               // ≤500
  targetQty?: number;           // ≥0, only for CONNECTION_DETAILS_PDF
}

// projects/dto/approve-planning.dto.ts
ApprovePlanningDto {
  assigneeUserId?: string;              // legacy single assignee (UUID)
  planningSawsManagerUserId?: string;   // station-1 manager (UUID)
  sawsWorkerUserIds?: string[];         // team mode (UUIDs)
}

// stations/dto/create-station-log.dto.ts
CreateStationLogDto {
  projectId: string;
  processedQty: number;         // ≥0
  issues?: string;
  workerId?: string;
  cutLength?: number;           // required at station 1 (mm/bar)
  extraPayload?: Record<string, unknown>;  // station-specific JSON snapshot
}

// stations/dto/issue-delivery-note.dto.ts
IssueDeliveryNoteDto {
  projectId: string;
  shippingType: 'INTERNAL' | 'EXTERNAL';
  externalPrice?: number;       // required (≥0, 2dp) when EXTERNAL
  lineItems: { lineKey: string; quantity: number /*≥1*/ }[];  // ≥1 item
}

// work-cycles/dto/work-cycle.dto.ts
WorkCycleAssignmentDto { userId: string; role: 'MANAGER'|'WORKER'; stationId?: number /*1–8*/ }
SetWorkCycleDailyTargetDto { dailyTargetQty?: number | null }  // ≤0/null = auto

// work-cycles/dto/report-cycle-progress.dto.ts
ReportCycleProgressDto { projectId: string; qty: number /*≥1*/; cutLength?: number | null }

// tracking/dto/add-beat.dto.ts
AddTrackingBeatDto {
  phase: TrackingPhase;         // PRODUCTION | SUPPLY | INSTALL
  occurredOn: string;           // YYYY-MM-DD
  qty: number;                  // ≥1
  deliveryNoteId?: string;      // SUPPLY only
  note?: string;                // ≤1000
}

// elevation/dto/report-defect.dto.ts
ReportDefectDto { cellId: string; returnedToStationId: number /*1–8*/; reason: string /*2–1000*/ }

// users/dto/create-user.dto.ts
CreateUserDto {
  email; password /*≥6*/; firstName; lastName;
  role: SkyflowRole; photoUrl?;
  managedStationId?: number;    // 1–7, only for STATION_MANAGER / SITE_MANAGER
}
```

---

## 11. Data Model (Prisma Schema)

PostgreSQL via Prisma. IDs are UUID strings unless noted. All timestamps are `DateTime`.

### Enums

| Enum | Values |
|---|---|
| `OrderStatus` | PENDING, IN_PROGRESS, COMPLETED, ON_HOLD |
| `ProjectFlowStatus` | PENDING_PLANNING, IN_PRODUCTION, COMPLETED |
| `ProductType` | UNIT, WINDOW |
| `ProductComponentKind` | BEAM, FRAME, GLASS_SINGLE, GLASS_DOUBLE, SASH |
| `DeliveryNoteShippingType` | INTERNAL, EXTERNAL |
| `DeliveryNoteStatus` | ACTIVE, CANCELLED |
| `ElevationCellKind` | SPANDREL, UNIT |
| `ElevationCellStatus` | PENDING, DONE |
| `ElevationMapStatus` | PROCESSING, READY, FAILED |
| `SkyflowRole` | WORKER, ADMIN, PLANNING, STATION_MANAGER, SITE_MANAGER |
| `ProjectLineMaterial` | ALUMINUM, STEEL |
| `ProjectMachiningRoute` | GLASS, ALU_RANGER |
| `ProjectAngleSourcing` | INTERNAL_LASER, EXTERNAL_SUPPLIER, NO_LASER |
| `CellDefectStatus` | OPEN, RESOLVED |
| `WorkCycleStatus` | DRAFT, OPEN, IN_PROGRESS, COMPLETED, RETURNED |
| `WorkCycleStationStatus` | PENDING, IN_PROGRESS, DONE |
| `WorkCycleAssignmentRole` | MANAGER, WORKER |
| `TrackingPhase` | PRODUCTION, SUPPLY, INSTALL |
| `DailyTargetSource` | MANUAL, PLANNING |
| `ProjectDocumentKind` | PURCHASE_ORDER, WORK_ORDER, ELEVATION_MAP, WINDOW_INSTRUCTION_PDF, QUANTITIES_PDF, ANGLE_INSTRUCTION_PDF, CONNECTION_DETAILS_PDF |

### Core entities & relationships

- **User** — auth + role + optional `managedStationId`. Relates to created/managed/assigned projects, daily targets, issued delivery notes, elevation cells, defects, work‑cycle assignments, tracking beats.
- **ProjectOrder** — the aggregate root. Config: `flowStatus`, `lineMaterial`, `machiningRoute`, `angleSourcing`, `originalLength`, `totalItems`, saws staffing, project manager/creator, site‑delivery expectations. Owns: station logs, scrap reports, documents, product items, saw work lines, pack photos, daily targets, delivery notes, tracking rows, elevation maps, window types, stages, facades, angles, steelwork details, cell defects, work cycles.
- **ProductItem / ProductComponent** — legacy Excel planning rows (unit/window instruction) and their components (beams/frames/glass/sash), including saws profile codes and spreadsheet coordinates.
- **SawStationWorkLine** — saws cut lines with images, cut length, profile code (legacy flow).
- **ProjectDocument** — a PDF (by `kind`) served from a public path; linked to elevation maps, window types (instruction/connection), angles, steelwork details, facades.
- **StationLog** — per‑station progress: `processedQty`, optional `cutLength`, `issues`, `workerId`, `workCycleId`, and `extraPayload` JSON (station‑specific snapshots).
- **ScrapReport** — per‑station scrap by `itemLength`, `scrapQty`, `profileKind` (CATALOG/DRAWN), `profileCode`.
- **PackReportPhoto** — station‑6 photos keyed `(projectId, slotIndex)`.
- **ProjectDeliveryNote** — issued note: `noteNumber`, `shippingType`, `status`, `externalPrice`, `documentPath`, `lineItems` JSON, issuer, timestamps.
- **WindowType** — `(projectId, code)` unique. Holds instruction/connection docs, `composition`, `hasAngles`, `angleCodes`, `setsPayload`, `partsPayload`, `totalQty`. Owns facade/stage quantities, elevation cells, and a 1:1 `WorkCycle`.
- **Facade / ProductionStage / FacadeQuantity / StageQuantity** — quantities model (sub‑elevations, stages, per‑facade/stage counts).
- **Angle** — ANG codes with quantity and instruction doc.
- **SteelworkDetail** — connection‑details appendix (view‑only) for steel projects.
- **ElevationMap / ElevationCell / CellDefect** — facade maps, per‑unit cells (bbox, status, window‑type link), and defect returns.
- **WorkCycle / WorkCycleStationProgress / WorkCycleAssignment** — per‑window‑type run, per‑station counters, staffing.
- **ModuleTrackingRow / ModuleTrackingBeat** — manager tracking board; rows unique on `(projectId, facadeLabel, moduleCode)`; beats carry phase + date + qty (+ optional delivery note for SUPPLY).
- **UserDailyTarget** — per‑worker daily target (MANUAL or PLANNING) with `dedupeKey` and optional `lineItems`.
- **ManufacturingPlan** — saved purchase‑order BOM extraction (S3 URL + JSON).

Most child relations use `onDelete: Cascade`; optional user links use `SetNull`. The schema defines indexes on foreign keys and common query paths (e.g. `(projectId, stationId)`, `(projectId, status)`, `(userId, targetDate desc)`).

---

## 12. File Storage & Static Assets

Uploaded and generated files are written into the **web app's** `public/` directory (sibling `../web/public/...`) so the Angular app can serve them directly. The API also streams a few asset types itself.

| Content | Location (public path) | Served by |
|---|---|---|
| Project documents (uploaded PDFs) | `/assets/project-docs/uploads/*.pdf` | Web static |
| Pack photos (station 6) | `/assets/pack-photos/*` | Web static |
| Assembly type photos (station 3) | `/assets/assembly-photos/*` | Web static |
| Delivery note PDFs | `/assets/delivery-notes/*.pdf` (or `SKYFLOW_DELIVERY_NOTES_DIR`) | Web static |
| Planning saws images (legacy) | `/planning-saws/{projectId}/*` | Web static |
| Planning glass crops | `/planning-glass/{projectId}/*` | Web static |
| Planning import images | streamed via `GET /api/planning-imports/:projectId/:filename` | API (public) |
| Elevation map page PNGs | `storage/elevation-maps/{mapId}/page-N.png`, streamed via `GET /api/elevation-maps/:mapId/:filename` | API (public) |

**Upload limits & filters (multer):** planning PDFs ≤ 25 MB; project docs ≤ 12 MB; pack/assembly photos ≤ 12 MB (jpeg/png/webp); legacy site delivery ≤ 20 MB. Uploaded PDFs are renamed to a random UUID; images get sanitized, prefixed filenames.

---

## 13. External Integrations

### Anthropic Claude (Vision)
- **Planning:** `WindowPlanningService` uses Claude to read raster‑only content from window instruction PDFs — ANG angle callouts, Hebrew set/parts tables (`partsPayload`), and glass panels — using high‑resolution tiled crops and majority voting. Text‑layer content is parsed deterministically first.
- **Purchase orders:** `PdfAnalysisService` uses Claude to extract a 10‑column Hebrew BOM table when the deterministic grid parser can't.
- Model from `ANTHROPIC_MODEL` (default `claude-3-5-sonnet-latest`); requires `ANTHROPIC_API_KEY`. When absent, vision passes are skipped (planning still works) and `pdf-analysis` mutating endpoints return `503`.

### AWS S3
- `PdfAnalysisService` backs up original PDFs (`manufacturing-plans/{date}/{uuid}.pdf`) and cropped row drawings, and issues presigned GET URLs (600s TTL) for private drawing previews. Requires `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`.

### Email (SMTP)
- `MailService` (nodemailer) attaches delivery‑note/document PDFs when `SMTP_HOST` + `SMTP_FROM` are configured. Otherwise callers return a `mailto:` link for the client's mail app. Site managers (`managedStationId = 7`) are notified on delivery‑note issuance.

---

## 14. Configuration (Environment Variables)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Recommended | JWT signing secret (dev fallback exists) |
| `PORT` | No | HTTP port (default 3000) |
| `CORS_ORIGINS` | No | Comma‑separated extra allowed origins |
| `ANTHROPIC_API_KEY` | Optional | Enables Claude vision / BOM AI |
| `ANTHROPIC_MODEL` | Optional | Overrides default Claude model |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `AWS_S3_BUCKET` | Optional | Enables `pdf-analysis` S3 backup/preview |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Optional | Enables SMTP email; otherwise `mailto:` fallback |
| `SKYFLOW_DELIVERY_NOTES_DIR` | Optional | Override delivery‑note PDF output dir |

> Local Postgres note (macOS/Kerberos): prefer `127.0.0.1` and `export PGGSSENCMODE=disable`. The `skyflow` DB role must exist first (see `scripts/init-db.sql`).

---

## 15. Build, Run, Migrate & Deploy

```bash
# Install (runs prisma generate via postinstall)
npm install

# Development (watch)
npm run start:dev

# Production
npm run build           # nest build → dist/
npm run start:prod      # node dist/main

# Prisma
npm run prisma:generate       # generate client
npm run prisma:migrate        # migrate deploy (production)
npm run prisma:migrate:dev    # dev migration
npm run prisma:seed           # seed demo data
npm run prisma:seed-demo-worker

# Quality
npm run lint
npm run format
npm run test          # unit
npm run test:e2e      # e2e
```

**Deploy (Render):** `scripts/render-predeploy.sh` runs `npx prisma migrate deploy` as the pre‑deploy command (uses Render's internal `DATABASE_URL`). Runtime assets (e.g. Hebrew font) are copied to `dist/assets` by `nest-cli.json`.

**Migrations:** 36 timestamped migrations under `prisma/migrations/` capture the incremental evolution (init → users/roles → planning flow → 4‑PDF flow → elevation maps → facades/stages → work cycles → module tracking).

---

## 16. Cross‑Cutting Conventions

- **Global JWT by default:** endpoints are protected unless `@Public()`. Add `@UseGuards(RolesGuard)` + `@Roles(...)` for role restrictions.
- **Validation:** all bodies use DTOs with `class-validator`; unknown fields are rejected. Query/path scalars are coerced by the transform pipe.
- **Append‑only snapshots:** granular station state (saw lines, gluing done map, assembly qty, parts checklist) is stored as `StationLog.extraPayload` JSON; readers merge from the newest logs ("latest wins" per key/line).
- **Two completion models:** work cycles take precedence over legacy station totals when cycles exist for a project.
- **Local vs UTC dates:** daily targets and tracking beats use **local** `YYYY-MM-DD` day keys; some dashboard charts use UTC day buckets.
- **Graceful degradation:** missing Anthropic/AWS/SMTP config disables only the dependent features; the API still boots and serves the rest.
- **Prisma lazy connect:** the app can start before the DB is reachable; the first query establishes the connection.
- **Money & lengths:** lengths are stored in millimeters (`Decimal`); external delivery price is `Decimal(14,2)` in ₪.
```