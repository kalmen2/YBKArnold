---
name: arnold-sketch
description: Generate client-facing 3D sketches and cut lists for Arnold Contract furniture from a parametric spec. Use when asked to sketch, model, draw, or visualize a credenza, casegood, millwork unit, table, or desk, or to build a quote item that needs a picture. Asks for every dimension and finish — never invents one.
---

# Arnold Sketch

Turns a set of confirmed dimensions and finishes into a GLB model, a rendered
view, and a cut list — for Arnold Contract casegoods, millwork, tables and desks.

The generator lives at `tools/arnold-drafter/`. This skill is how to drive it.

## The rule: never assume a number

**You may not invent, estimate, round, or "use a typical" dimension, finish,
count, or reveal. Not one.** If a value is missing, you ask. If the customer
does not know, you ask them to find out — you do not fill it in and flag it later.

This is enforced in code, not just here. Every parameter in
`tools/arnold-drafter/catalog/` is declared with **no default**. A schema that
declares a `default` throws a "schema bug" error at load. If the spec is
incomplete, `build` exits non-zero, generates nothing, and prints every missing
parameter with the exact question to ask.

So the failure mode is safe: the worst you can do is generate nothing. The one
thing you must never do is route around the error by supplying a plausible
number yourself.

Two things that are *not* assumptions, and are fine:
- **Conditional parameters.** `toeKickHeight` doesn't apply to a legged base. The
  schema's `when` handles that. Not applicable ≠ assumed.
- **Derived geometry.** Carcass height = overall − top − base. That's arithmetic
  on confirmed numbers, not a guess.

## Workflow

### 1. Pick the product type

```bash
node tools/arnold-drafter/cli.mjs list
```

Currently `casegood.credenza` and `table.rectangular`. If the customer's item is
not one of these, **say so and stop** — do not force it into a near-miss type.
Adding a type is a small job (see *Extending* below); offer that instead.

### 2. Get the full question list

```bash
node tools/arnold-drafter/cli.mjs questions casegood.credenza
```

Prints every parameter with the question to ask verbatim. `~` marks a parameter
that only applies depending on an earlier answer.

### 3. Ask in batches, not one at a time

Put the whole applicable list to the user in one message, grouped (carcass /
base / doors / finishes). Conditional parameters cascade: once they answer
`pullStyle: bar`, a second short round picks up the four bar-pull dimensions.
Two rounds is normal. Twelve is not.

Use the finish names from `cli.mjs list`. If the customer names a finish that
isn't in the palette, **do not map it to the nearest one** — add it to
`tools/arnold-drafter/lib/materials.mjs` with their real colour, or ask which
listed finish they mean.

### 4. Write the spec

Save to `tools/arnold-drafter/specs/<quote>-<item>.json`:

```json
{
  "specVersion": 1,
  "units": "in",
  "project": {
    "quoteNumber": "Q-1234",
    "client": "Client name",
    "itemNumber": 1,
    "description": "Reception credenza"
  },
  "product": { "type": "casegood.credenza", "params": { } }
}
```

`units` is `in` or `mm` and applies to bare numbers. Strings may carry their own
unit and override it: `72`, `"72\""`, `"6'"`, `"6'-6\""`, `"3/4\""`,
`"18 3/4\""`, `"1220mm"` all parse. Anything unparseable is rejected, never
guessed.

Keep spec files. They are the record of what was approved, and re-running one
after a revision is how you keep the sketch and the quote in step.

### 5. Build

```bash
node tools/arnold-drafter/cli.mjs build tools/arnold-drafter/specs/your-spec.json
```

Writes `<name>.glb` and `<name>.spec-sheet.json` (summary + cut list + the spec
that produced it) into `tools/arnold-drafter/out/`.

If it exits non-zero, read the list, ask those questions, and re-run. Do not
edit the schema to make the error go away.

### 6. Verify and look at it

```bash
node scripts/verify-3d-model.mjs tools/arnold-drafter/out/<name>.glb --out tmp/sketch-verify
```

This is the project's existing harness: it renders in headless Chrome with the
customer's real viewer settings and checks load, colour fidelity, and stability
through rotation. **Then actually Read one of the PNGs.** The harness catches
colour and material faults; it cannot tell you the doors are on the wrong side.
Look before showing the customer.

Known interaction: a model made entirely of one dark finish (all-walnut, all
ebonized) can trip `Render is too dark` on `BUDGET.minMeanLuminance`, which is
tuned for mixed-material customer models. Check the hue-error line — if colours
match the file and the render looks right, it's a threshold artifact. **Report it
as such; do not edit the budget to make it pass.**

### 7. Hand it over

Show the render, the overall dimensions, and the cut-list totals. State the
finish palette caveat if any placeholder finish was used (see *Known gaps*).

## Extending

Adding a product type — the intended way to grow this:

1. New module in `tools/arnold-drafter/catalog/`, default-exporting
   `{ type, label, params, build }`.
2. Each param: `{ key, type, ask, when?, note?, min?, max?, values? }`.
   Types: `dimension`, `integer`, `number`, `boolean`, `enum`, `finish`, `string`.
   **No `default` key — the loader rejects it.**
3. `build(mesh, params)` receives every dimension already converted to **metres**.
   Coordinates: X = width centred on 0, Y = height from floor 0, Z = depth with
   **+Z as the front face**.
4. Register it in `catalog/index.mjs`.
5. Build a spec, run the verify harness, and Read the render before trusting it.

Guard rails belong in `build` — throw a clear error when numbers conflict (a top
thicker than the whole cabinet, insets that cross at the centre). That's how a
typo becomes a question instead of a silent deformity.

Corrections the user gives you about Arnold's construction standards go **into
the catalog and this file**, not into your head for the rest of the session.
That is what "the skill can be updated as we work" means in practice.

## Known gaps

Say these plainly when they come up. Do not paper over them.

- **The finish palette is a placeholder.** The entries in `lib/materials.mjs` are
  plausible stand-ins, not Arnold's finish schedule. Colours must be confirmed
  against real samples before a render goes to a customer. Replacing this with
  the real schedule is the highest-value next job.
- **No drawers.** `casegood.credenza` models doors only.
- **No adjustable shelves, no interior fit-out.**
- **Table bases:** four-legs and panel-ends only. No trestle, no pedestal, no
  X-base.
- **Edge profiles are square.** No eased, bullnose, or mitred edge geometry.
- **No 2D dimensioned drawing yet.** 3D and the cut list only. DXF output via
  `ezdxf` is the planned next stage.
- **Pricing is not wired.** The cut list carries per-finish face area in sq ft,
  which is the input pricing needs, but no rates, labour, or markup exist yet.
  Turning a cut list into `CrmQuoteLineItem[]` needs Arnold's pricing rules —
  ask for them rather than inventing a number per square foot.
