---
name: arnold-sketch
description: Generate client-facing 3D sketches and cut lists for Arnold Contract furniture from a parametric spec, working from a photo, a full dimension set, or just one overall size. Use when asked to sketch, model, draw, or visualize a credenza, casegood, millwork unit, table, or desk, or to build a quote item that needs a picture.
---

# Arnold Sketch

Turns confirmed sizes and finishes into a **DXF drawing sheet** (opens in
AutoCAD), a textured GLB 3D model, **rendered presentation views**, and a cut
list — for Arnold Contract casegoods, millwork, tables and desks.

Generator: `tools/arnold-drafter/`. This file is how to drive it.

## The rule: ask for decisions, derive proportions

Two tiers. Getting this distinction right is the whole skill.

**PRIMARY — you must ask. Never guess, never estimate, never "use a typical".**
Overall size, how many doors, base type, finishes. These carry commercial and
functional intent. If one is missing the build stops and prints the question.
Do not route around that error by supplying a number yourself.

**DETAIL — derive, do not ask.** Reveals, overhangs, panel thickness, pull
sizing, apron and stretcher proportions. These scale from the primaries by a
stated rule. Interrogating the customer about every 1/8" reveal is how a
five-minute sketch becomes a forty-question interview. Don't.

A derived value is not a silent assumption. Every one is printed with the rule
that produced it, so a wrong proportion gets caught by eye. Two levels:

- `!` **headline derived** (a table's depth and height, a credenza's depth and
  height) — **show these to the customer and get a yes** before the sketch goes out.
- `·` **detail derived** — report them, but don't stop the conversation for them.

Any derived value is pinned by putting it in the spec. Explicit always wins.

`default` keys stay forbidden in the catalog — the loader throws. A default is a
number nobody sees; a derive rule is visible arithmetic on confirmed inputs.

## Working from a photo

Common case: the customer sends a picture and one dimension.

1. **Read the image and say what you see.** Door and drawer count, base type
   (toe kick / legs / plinth / wall-hung), pull style, apron or stretcher,
   proportions, finish family. Put this in writing so they can correct you.
2. **Never read a dimension off a photo.** Perspective makes that a guess. A
   photo tells you *configuration*, never *size*.
3. **Ask only for the primaries the photo can't give** — usually just the
   overall width, and the exact finishes.
4. **Let proportion do the rest.** If it looks longer than it is deep, the
   derive rules already handle that. Don't hand-measure pixels.
5. If the photo shows something the catalog can't build — drawers, a curved
   front, carved detail, a waterfall edge — **say so plainly**. Do not
   substitute a flat door and stay quiet about it.

**Match the reference.** When the customer supplies an image, the output is
expected to look like it. Getting the overall box right is not enough: the panel
rhythm, the base, the counter, the pull style and the proportions all have to
read the same. Before handing over, put the render and the reference side by
side and name every difference you can see. Fix what the catalog can express;
report what it can't.

## Workflow

**1. Pick the type.** `node tools/arnold-drafter/cli.mjs list`
Currently `casegood.credenza` and `table.rectangular`. If the item isn't one of
these, say so and stop — don't force it into a near-miss. Offer to add a type.

**2. See what to ask.**
```bash
node tools/arnold-drafter/cli.mjs questions casegood.credenza
```
Splits ASK from DERIVED. Ask only the first list — usually 3 to 8 questions.

**3. Ask in one batch**, grouped. Conditional params cascade: answering
`pullStyle` may open a couple more. Two rounds is normal.

Use finish names from `cli.mjs list`. If the customer names a finish that isn't
there, **do not map it to the nearest one** — add it to `lib/materials.mjs` with
their real colour, or ask which listed finish they mean.

**4. Write the spec** to `tools/arnold-drafter/specs/<quote>-<item>.json`:
```json
{
  "specVersion": 1,
  "units": "in",
  "project": { "quoteNumber": "Q-1234", "client": "Name", "itemNumber": 1,
               "description": "Reception credenza" },
  "product": { "type": "casegood.credenza", "params": { } }
}
```
`units` is `in` or `mm` for bare numbers. Strings carry their own unit and
override: `72`, `"72\""`, `"6'"`, `"6'-6\""`, `"3/4\""`, `"1220mm"`. Anything
unparseable is rejected, never guessed. Keep spec files — they are the record of
what was approved, and re-running one after a revision keeps sketch and quote in step.

**5. Build.**
```bash
node tools/arnold-drafter/cli.mjs build tools/arnold-drafter/specs/your-spec.json --render
```
`--render` also produces the presentation images. Leave it off for a quick
geometry check; always use it before anything reaches a customer.
Writes three files to `out/`:
- `<name>.dxf` — plan, front elevation, right side elevation and a 3/4
  isometric, all hidden-line removed, plus dimensions and the Arnold title
  block, on layers (OUTLINE / DETAIL / DIMS / TEXT / TITLE / VIEWLABEL).
  Third-angle projection, full size (1:1) in inches. **This is the AutoCAD file.**
- `<name>.glb` — the 3D model for the customer viewer.
- `<name>.spec-sheet.json` — summary, cut list, and the spec that produced it.

Non-zero exit means a primary is missing — ask, don't patch the schema.

**6. Look at the presentation renders** in `tmp/presentation/`. These are the
customer-facing images: full PBR, image-based lighting, soft shadows, filmic
tone mapping — deliberately NOT the flat SketchUp shading of the viewer harness.
Four views: `hero` (3/4, low), `left`, `front`, `detail` (tight crop).

**Compare each against the customer's reference image and name the differences.**
Grain direction, panel rhythm, finish warmth, base detail, edge treatment. Fix
what the catalog can express; report what it can't. "The dimensions match" is
not the standard — it has to look like the piece.

**6a. Check the drawing sheet.** You cannot open AutoCAD, so render the DXF back
from the written file and look at it:
```bash
node tools/arnold-drafter/cli.mjs preview tools/arnold-drafter/out/<name>.dxf
```
Writes an SVG beside it. Rasterise and Read it:
```bash
node -e "const s=require('./functions/node_modules/sharp/dist/index.cjs');const{readFileSync}=require('fs');s(Buffer.from(readFileSync(process.argv[1])),{density:120}).png().toFile('tmp/sheet.png').then(i=>console.log(i.width+'x'+i.height))" tools/arnold-drafter/out/<name>.svg
```
The preview parses the DXF file itself, not the in-memory model — so a malformed
group code breaks the preview the same way it would break a CAD seat.

**6b. Verify the 3D model, then look.**
```bash
node scripts/verify-3d-model.mjs tools/arnold-drafter/out/<name>.glb --out tmp/sketch-verify
```
The project's existing harness: renders in headless Chrome with the customer's
real viewer settings, checks load, colour fidelity, and stability through
rotation. **Then Read one of the PNGs.** It catches colour faults; it cannot
tell you the doors are on the wrong side.

Known interaction: a model made entirely of one dark finish can trip
`Render is too dark` on `BUDGET.minMeanLuminance`, tuned for mixed-material
models. If the hue-error line is clean and the render looks right, it's a
threshold artifact. **Report it as such — do not edit the budget to make it pass.**

**7. Hand over.** Show the render, the overall size, the `!` headline derived
dimensions for confirmation, and the cut-list totals. State the finish caveat
below if a placeholder finish was used.

## Extending

1. New module in `catalog/`, default-exporting `{ type, label, params, build }`.
2. Params: `{ key, type, ask?, when?, derive?, rule?, confirm?, note?, min?, max?, values? }`.
   Types: `dimension`, `integer`, `number`, `boolean`, `enum`, `finish`, `string`.
   - Primary → give it `ask`, no `derive`.
   - Detail → give it `derive` **and** `rule` (the loader throws without `rule`).
   - Headline derived → add `confirm: true`.
   - **No `default` key, ever.**
3. `build(mesh, params)` gets every dimension in **metres**. X = width centred on
   0, Y = height from floor 0, Z = depth with **+Z as the front face**.
4. Register in `catalog/index.mjs`.
5. Build a spec, run the verify harness, Read the render before trusting it.

Guard rails go in `build` — throw a clear error when numbers conflict. That's how
a typo becomes a question instead of a silent deformity.

Corrections the user gives about Arnold's construction standards go **into the
catalog and this file**, not just into the current conversation. Wrong proportion?
Change the `derive` rule. Wrong question? Change the `ask`. That is what "the
skill can be updated as we work" means in practice.

## Known gaps

Say these plainly. Do not paper over them.

- **The finish palette is a placeholder.** `lib/materials.mjs` holds plausible
  stand-ins, not Arnold's finish schedule. Confirm against real samples before a
  render reaches a customer. Replacing it is the highest-value next job.
- **The derive rules are my proportions, not Arnold's standards.** Every `rule`
  string is a starting guess at shop practice. They are meant to be corrected.
- **No drawers** on casegoods. Doors only.
- **No adjustable shelves or interior fit-out.**
- **Table bases:** four-legs and panel-ends only. No trestle, pedestal, or X-base.
- **Square edges only.** No eased, bullnose, mitred, or waterfall geometry.
- **No curves, veining, carved detail, or applied mouldings.** Anything with a
  radiused corner, a diagonal or chevron panel split, or a woven/cane texture is
  out of reach. Say so rather than substituting a straight panel — a sketch that
  quietly differs from the reference is worse than no sketch.
- **Dimensions in the DXF are drawn geometry, not associative DIMENSION entities.**
  They look and print correctly, but stretching the geometry in AutoCAD will not
  update the number. Regenerate from the spec instead of editing the DXF.
- **The sheet carries overall dimensions only** — no part-by-part dimensioning,
  no section cuts, no joinery callouts. It is a client sketch, not a shop drawing.
- **Panel/segment spacing is distributed evenly** unless the spec pins it. If a
  reference image shows an uneven rhythm (a wider centre panel, say), say so and
  ask for the dimensions — do not eyeball them off the picture.
- **Pricing is not wired.** The cut list carries per-finish face area in sq ft,
  which is what pricing consumes, but no rates, labour, or markup exist. Turning
  a cut list into `CrmQuoteLineItem[]` needs Arnold's pricing rules — ask for
  them rather than inventing a rate.
