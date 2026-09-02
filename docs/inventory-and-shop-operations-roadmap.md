# Inventory, Purchasing & Shop Operations Roadmap

**Status:** Planning document  
**Purpose:** Build one connected operating system for purchasing, inventory, job materials, shop work, cut parts, and shipping—while introducing it in manageable phases.

## 1. The outcome we want

The website becomes the source of truth for material and production flow:

1. A sales/order record contains the materials and parts it requires.
2. The company creates purchase orders in the website; they are sent to QuickBooks in the background.
3. Each purchased line is tracked from order date, through expected arrival, receiving, bill, stock/job allocation, and final use.
4. Management can immediately see missing promised dates, late materials, inventory on hand, vendor reliability, material cost, and job readiness.
5. Shop workers use scanners at simple stations instead of manual timesheets and paper-only tracking.
6. IMOS part lists eventually feed individual cut-part tracking, storage locations, rework, assembly, and shipment verification.

This is a long-term shop operating system, not one large release. Every phase must be useful on its own and must not depend on equipment that is not yet installed.

## 2. Operating model

### Two kinds of purchased material

| Type | Meaning | Inventory behavior |
| --- | --- | --- |
| **Job-direct material** | Purchased specifically for one sales/order/job. | Reserve it for that job when received. It normally does not become generally available stock. |
| **Stock material** | Purchased for general use (hardware, sheet goods, screws, consumables, etc.). | Add it to a warehouse/location quantity. Workers later issue it to jobs. |

Some purchase orders will contain both types. The system must therefore track allocation **per purchase-order line**, not just per purchase order.

### Key records and relationships

```text
Order / Job
  └─ material requirements (manual at first; IMOS import later)
       └─ purchase-order lines
            ├─ vendor
            ├─ expected arrival date
            ├─ direct-to-job or stock allocation
            └─ receiving records
                 └─ bill(s) imported/linked from QuickBooks

Stock item
  └─ inventory transactions: receive, issue to job, adjustment, return, transfer
       └─ on-hand balance by location and unit of measure
```

### Important rule: an item is not a single status

A line can be partially ordered, partially received, partially billed, and partially issued. Quantities and transaction history must be retained; do not use one simple “received/not received” switch.

## 3. Purchase orders, QuickBooks, bills, and receiving

### Future workflow

1. Purchasing creates a PO in the website and selects the vendor, items, quantities, prices, promised dates, and job/stock allocation.
2. The website sends the PO to QuickBooks and stores the QuickBooks ID and sync status.
3. A purchaser can update promised dates or quantities; changes must be logged.
4. When material physically arrives, receiving creates a receipt for the actual items/quantities received and the receipt date.
5. One PO may have multiple receipts and multiple QuickBooks bills. Each bill is linked to its PO and, where possible, its PO lines/receipts.
6. Receiving job-direct material makes it available/reserved for its assigned job. Receiving stock increases on-hand inventory at a chosen location.
7. Quantity differences, damaged material, substitutions, and returns are recorded as exceptions—not silently overwritten.

### Date definitions (must remain configurable)

For the initial version, delivery lead time is:

```text
arrival / receipt date − PO creation date
```

Later we may change the start date (for example, vendor acknowledgment date) or the completion date (for example, first receipt vs. full receipt). Store all relevant dates so the calculation can be changed without losing history.

### QuickBooks integration principles

- The website owns the purchasing workflow and operational detail.
- QuickBooks remains the accounting system for PO and bill financial records.
- Synchronization must be idempotent: retrying must not make duplicate QuickBooks POs or bills.
- Sync errors must be visible and actionable in the website.
- Do not assume a QuickBooks bill proves physical receipt. A receiver must confirm actual arrival.

## 4. Dashboard KPIs and alerts

### Immediate purchasing KPIs

| KPI | Definition |
| --- | --- |
| **Open items missing due date** | Open PO lines with no promised/expected arrival date. |
| **Late open items** | Open PO lines whose expected arrival date is before today and are not fully received. |
| **Jobs blocked by material** | Jobs with required direct material not fully received by its needed date. |
| **Open PO value** | Value of unreceived PO quantity. |

The first two are specifically requested and should appear as prominent clickable dashboard cards. Clicking one opens the exact PO lines that cause the count.

### Vendor scorecard

Calculate at vendor and vendor-item level:

- ordered value and received value;
- average quoted unit price and price trend;
- average actual lead time;
- on-time delivery rate;
- late receipt count and late quantity;
- average days early/late;
- partial-receipt rate;
- data-quality rate (lines with promised dates).

For initial reporting, a receipt is **on time** when its receipt date is on or before the latest promised date in effect at the time. We should later decide whether a partially received line is scored at first receipt or only once it is fully received.

## 5. Inventory and material issue

### Units of measure

Every item needs a base unit of measure and permitted transaction unit(s):

- countable items: each, box, sheet, board, panel;
- measured stock: pound, foot, square foot, gallon, etc.;
- optional conversion rules: e.g., boxes to each, sheets to square feet.

Never mix units without an explicit conversion rule.

### Weighted-material station (screws/fasteners example)

For items that cannot realistically be counted:

1. Worker scans their badge or signs in.
2. Worker scans/selects the job number.
3. Worker scans the material barcode.
4. A connected scale provides the weight used (or the worker enters it initially).
5. The system records a **stock issue** transaction: item, weight, date/time, worker, job, station, and optional notes.
6. On-hand inventory decreases immediately; reporting can show usage and cost by job.

The first software version should support manual weight entry. Scale integration can be added after the physical station and scale are selected.

### Inventory controls

- All balance changes are immutable inventory transactions; corrections use adjustments, not edits to history.
- Track on-hand, reserved, available, and allocated-to-job quantities separately.
- Require a reason and authorized user for adjustments.
- Run periodic physical counts and reconcile differences.
- Begin with practical locations (warehouse, hardware room, shop floor, receiving) before modeling every shelf/bin.

## 6. Shop labor and work-order scanning

### Goal

Replace manual data entry with simple shop-floor scanning on a phone, tablet, or fixed computer.

### Worker workflow

1. Worker scans badge/login and scans a work order or job barcode.
2. The system starts a work session for that job and operation.
3. When moving to another job, the worker scans the new work order; the prior session is automatically stopped and a new one starts.
4. Worker can explicitly pause, end shift, or select approved non-job time (break, cleanup, meeting, maintenance).
5. Supervisors review exceptions, missed punches, and corrections.

### Data captured

- worker, job/work order, operation/station, start/end time, elapsed time;
- scanner/device and location;
- optional quantity completed, scrap/rework reason, and notes.

Keep the existing timesheet workflow during transition. Scanning must be piloted with a small group before it becomes the official time record.

## 7. IMOS, CNC, labels, parts, storage, and rework

### Future IMOS integration

IMOS is expected to provide drawings, part lists, hardware requirements, and identifiers. We will first establish the available export format/API and map it into a versioned job import.

An imported job should create:

- a job revision and source import record;
- part records with unique part IDs/labels;
- required quantity, material, dimensions, operation path, and job linkage;
- hardware/material requirements;
- exceptions for unmapped or invalid data.

Do not design against assumed IMOS fields. Obtain a representative export from real work before building the importer.

### CNC cut and label workflow

1. CNC operator opens/scans the job and part.
2. When a part is cut, the operator confirms the quantity and prints/applies a barcode label.
3. The system records the part as cut, identifies its job/revision, and prompts for a storage location.
4. A worker scans the part and the shelf/location when storing or moving it.
5. If a part is damaged, the worker scans it and chooses a reason; it becomes scrap/rework and creates a replacement request for CNC/planning.

### Storage rule

- Each shelf/location has a barcode and capacity/constraints.
- One shelf must not contain parts from two different orders/jobs.
- When a part is stored, the system recommends an eligible empty shelf.
- If no appropriate space is available, the worker selects **No room**; the system records the exception and proposes/escalates an alternative location.

We need to define whether a “shelf” means a full rack shelf, a bin, or another physical unit before configuration.

### Shipment verification

Before shipping, a worker scans the job and verifies all required labeled parts and hardware. The system must show missing, damaged, uncut, and unlocated items and prevent a “complete” shipment confirmation until exceptions are deliberately approved.

## 8. Rollout plan

### Phase 0 — Foundation and decisions (start now)

- Define item master, vendors, units of measure, locations, and basic job identifiers.
- Audit the existing QuickBooks integration and existing Purchasing page/data.
- Define PO, receipt, bill, inventory transaction, and vendor-performance data models.
- Establish barcode standards for jobs, materials, locations, workers, POs, and parts.
- Select initial dashboard definitions and data-quality rules.

**Deliverable:** approved workflow/data design and a small real-data pilot list.

### Phase 1 — Website purchase orders and receiving (start now)

- Build PO creation and approval in the website.
- Send/sync POs to QuickBooks with status/error tracking.
- Add PO line promised dates, job/stock allocation, partial receiving, and receiving dates.
- Link multiple bills to a PO.
- Add dashboard cards for missing due dates and late items.

**Success measure:** Purchasing no longer needs to create new POs directly in QuickBooks for the pilot vendors.

### Phase 2 — Vendor pricing and performance (start after Phase 1 has data)

- Build vendor/item price history and comparison views.
- Calculate delivery lead time, on-time rate, late counts, and late days.
- Add vendor scorecards and purchasing alerts.

**Success measure:** Purchasing can choose suppliers using actual price and delivery history.

### Phase 3 — Basic stock inventory (can begin in parallel once data model is ready)

- Create stock-item catalog, locations, receiving to stock, manual issue-to-job, adjustments, and physical counts.
- Track on-hand/reserved/available stock and material cost by job.
- Pilot hardware/fasteners first, including manual weight entry.

**Success measure:** A selected set of stock materials has reliable on-hand quantity and job usage history.

### Phase 4 — Shop-floor work scanning (after a workstation pilot is available)

- Add barcode login and scan-to-start/stop job sessions.
- Add supervisor exceptions and maintain the current timesheet as a fallback.
- Pilot at one station before broader rollout.

**Success measure:** Pilot labor time is recorded through scans with fewer corrections than manual entry.

### Phase 5 — Connected scale and inventory stations (after hardware selection)

- Add scan-to-issue material workflow and scale integration.
- Install the material-issue station near the hardware/closet area.
- Add audits and replenishment thresholds.

### Phase 6 — IMOS/CNC part tracking and storage (requires IMOS sample/export and shop stations)

- Build import/mapping and part-label workflow.
- Add CNC cut confirmation, storage assignment, moves, damage/rework, and replacement queue.
- Add shipping scan/verification.

**Success measure:** A pilot job can be imported, cut, stored, assembled, and shipped with a complete digital part trail.

## 9. Hardware and physical setup (not required to start software)

Later hardware will likely include:

- barcode scanners at CNC, assembly/work areas, shipping, and material issue;
- one shared computer/tablet at each initial pilot station;
- label printer(s) suitable for durable part labels;
- shelf/location barcode labels;
- worker badges or printed ID barcodes;
- a scale with an integration option for the materials station;
- reliable shop Wi-Fi and protected mounting/power.

Start with low-cost shared stations and browser-based scanning; do not buy a full shop deployment until the pilot workflow is proven.

## 10. Decisions needed before implementation

1. What existing purchasing data and QuickBooks objects already sync into the website?
2. Which vendors and item categories should be in the first PO/receiving pilot?
3. What is the exact definition of an expected arrival date: vendor promise, requested delivery date, or another date?
4. What counts as “on time” for partial deliveries?
5. Who can create, approve, receive, adjust inventory, and edit promised dates?
6. Which items are job-direct versus stock in the initial rollout?
7. What locations exist today, and what physical unit must remain single-job (shelf, bin, cart, rack bay)?
8. What IMOS export/API and sample project can we use for discovery?
9. Which station and team are best for the first scanning pilot?
10. Which existing reports/workflows must stay available during transition?

## 11. Guiding implementation rules

- Build from real shop transactions, not only ideal workflows.
- Keep a full audit trail; operational history must be explainable.
- Use feature flags and pilots so a new workflow does not interrupt production.
- Make scanning fast: a normal transaction should be only a few scans/clicks.
- Design for partial quantities, corrections, and exceptions from the beginning.
- Keep accountancy and operations connected but do not let accounting records erase physical reality.
- Validate each phase with real users before rolling it out more widely.

## 12. Recommended first work item

Start with **Phase 0 plus the Phase 1 PO/receiving design**: inspect the existing Purchasing and QuickBooks code, map the current data flow, and design the exact records/screens required for website-created purchase orders, PO line due dates, receiving, and QuickBooks synchronization. This is the foundation for the dashboard KPIs, vendor scorecards, and future inventory.
