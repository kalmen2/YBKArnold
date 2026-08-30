// 23 live round-trip checks.
//
// Edits real Monday cards, runs the real refresh, asserts Arnold picked the
// change up, then reverts and refreshes again to prove it goes back.
// Writes land in the sandbox orders DB; Monday is always restored.

import { refresh, order, setColumn, setName, revertAll, journalSize, closeAll, readColumn } from './roundtrip-harness.mjs'

const SHIPPED = '1072680042'
const NEW_ORDERS_25 = '8142996505'

// 240304 - shipped 2024, content-rich, safe to edit and restore.
const A = { num: '240304', item: '6280018416', board: SHIPPED }
// 241028 - shipped, empty fields; used to manufacture an ACK collision.
const B = { num: '241028', item: '12584213036', board: SHIPPED }
// 250307 - has BOTH a production and a financial card.
const C = { num: '250307', prod: '8766483548', fin: '8766452705', finBoard: NEW_ORDERS_25 }

const COL = { notes: 'text95', description: 'text81', po: 'text2', leadTime: 'due_date', ack: 'text9', orderValue: 'numbers' }

const results = []
let n = 0
function check(name, pass, detail = '') {
  n += 1
  results.push({ n, name, pass, detail })
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${String(n).padStart(2)} - ${name}${detail ? `  [${detail}]` : ''}`)
}

const STAMP = 'RT' + Date.now().toString().slice(-6)
const baseline = {}

try {
  // ---------------- Phase 0: baseline ----------------
  console.log('\nPhase 0 - baseline')
  const s0 = await refresh('baseline')
  check('refresh completes with no warnings', (s0?.warnings ?? []).length === 0, (s0?.warnings ?? []).join('; ').slice(0, 90))

  const c0 = await order(C.num)
  check('production and financial links are distinct ids',
    Boolean(c0?.monday_production_item_id) && Boolean(c0?.monday_financial_item_id)
      && c0.monday_production_item_id !== c0.monday_financial_item_id,
    `prod=${c0?.monday_production_item_id} fin=${c0?.monday_financial_item_id}`)

  const a0 = await order(A.num)
  baseline.notes = a0?.monday_notes ?? null
  baseline.description = a0?.monday_description ?? null
  baseline.po = a0?.po_number ?? null
  baseline.name = a0?.order_name ?? null
  baseline.due = a0?.Due_date ?? null
  baseline.prodItem = a0?.monday_production_item_id ?? null
  check(`${A.num} starts healthy`, a0?.monday_link_status === 'ok', `status=${a0?.monday_link_status}`)

  // ---------------- Phase 1: forward edits ----------------
  console.log('\nPhase 1 - edit Monday, then refresh')
  await setColumn(A.item, A.board, COL.notes, `${STAMP} notes`)
  await setColumn(A.item, A.board, COL.description, `${STAMP} description`)
  await setColumn(A.item, A.board, COL.po, `${STAMP}-PO`)
  await setColumn(A.item, A.board, COL.leadTime, '2027-01-15')
  await setName(A.item, A.board, `${STAMP} renamed / ${A.num}`)
  const finBefore = await readColumn(C.fin, COL.orderValue)
  await setColumn(C.fin, C.finBoard, COL.orderValue, '424242')
  console.log(`    ${journalSize()} Monday edits made`)

  await refresh('after-edits')
  const a1 = await order(A.num)
  const c1 = await order(C.num)

  check('notes change reached Arnold', a1?.monday_notes === `${STAMP} notes`, String(a1?.monday_notes))
  check('description change reached Arnold', a1?.monday_description === `${STAMP} description`, String(a1?.monday_description))
  check('PO number change reached Arnold', a1?.po_number === `${STAMP}-PO`, String(a1?.po_number))
  check('lead-time date change reached Arnold', String(a1?.Due_date ?? '').startsWith('2027-01-15'), String(a1?.Due_date))
  check('item rename reached Arnold', String(a1?.order_name ?? '').includes(STAMP), String(a1?.order_name))
  check('financial order value reached Arnold', Number(c1?.orderValue) === 424242, String(c1?.orderValue))
  check('content edits did not move the production link', a1?.monday_production_item_id === baseline.prodItem,
    `${baseline.prodItem} -> ${a1?.monday_production_item_id}`)
  check('content edits did not move the financial link', c1?.monday_financial_item_id === C.fin,
    `${C.fin} -> ${c1?.monday_financial_item_id}`)
  check('order still resolves cleanly after edits', a1?.monday_link_status === 'ok', `status=${a1?.monday_link_status}`)

  // ---------------- Phase 2: revert ----------------
  console.log('\nPhase 2 - revert Monday, then refresh')
  console.log(`    reverting ${journalSize()} edits`)
  await revertAll()
  await refresh('after-revert')
  const a2 = await order(A.num)
  const c2 = await order(C.num)

  check('notes restored', (a2?.monday_notes ?? null) === baseline.notes, `${JSON.stringify(a2?.monday_notes)}`)
  check('description restored', (a2?.monday_description ?? null) === baseline.description, `${JSON.stringify(a2?.monday_description)}`)
  check('PO number restored', (a2?.po_number ?? null) === baseline.po, `${JSON.stringify(a2?.po_number)}`)
  check('lead-time date restored', (a2?.Due_date ?? null) === baseline.due, `${a2?.Due_date}`)
  check('item name restored', (a2?.order_name ?? null) === baseline.name, `${JSON.stringify(a2?.order_name)}`)
  check('financial order value restored', String(c2?.orderValue ?? '') === String(finBefore.text ?? '').replace(/[^0-9.]/g, ''),
    `${c2?.orderValue} vs ${finBefore.text}`)
  check('link status still ok after revert', a2?.monday_link_status === 'ok', `status=${a2?.monday_link_status}`)

  // ---------------- Phase 3: ACK collision ----------------
  console.log('\nPhase 3 - manufacture a duplicate ACK, then refresh')
  const bAck = await readColumn(B.item, COL.ack)
  await setColumn(B.item, B.board, COL.ack, A.num) // B now collides with A
  console.log(`    ${B.item} ack "${bAck.text}" -> "${A.num}" (collides with ${A.item})`)

  await refresh('after-collision')
  const a3 = await order(A.num)

  check('collision is reported as duplicate', a3?.monday_link_status === 'duplicate', `status=${a3?.monday_link_status}`)
  check('duplicate records both candidates', (a3?.monday_link_candidates ?? []).length >= 2,
    `${(a3?.monday_link_candidates ?? []).length} candidates`)
  check('duplicate candidates name the colliding cards',
    (a3?.monday_link_candidates ?? []).some((x) => x.itemId === A.item)
    && (a3?.monday_link_candidates ?? []).some((x) => x.itemId === B.item),
    (a3?.monday_link_candidates ?? []).map((x) => x.itemId).join(','))
  check('duplicate did NOT clobber the stored production link', a3?.monday_production_item_id === baseline.prodItem,
    `${a3?.monday_production_item_id}`)
  check('refresh still recorded a verification timestamp', Boolean(a3?.monday_links_verified_at), String(a3?.monday_links_verified_at))

  // ---------------- Phase 4: resolve collision ----------------
  console.log('\nPhase 4 - undo the collision, then refresh')
  await revertAll()
  await refresh('after-collision-revert')
  const a4 = await order(A.num)
  const c4 = await order(C.num)

  check('duplicate clears once the ACK collision is undone', a4?.monday_link_status === 'ok', `status=${a4?.monday_link_status}`)
  check('candidate list is emptied when healthy', (a4?.monday_link_candidates ?? []).length === 0,
    `${(a4?.monday_link_candidates ?? []).length}`)
  check('production link survived the whole round trip', a4?.monday_production_item_id === baseline.prodItem,
    `${baseline.prodItem} -> ${a4?.monday_production_item_id}`)
  check('an order on two boards is never called a duplicate', c4?.monday_link_status !== 'duplicate',
    `${C.num} status=${c4?.monday_link_status}`)
  check('all fields are back to their original values',
    (a4?.monday_notes ?? null) === baseline.notes
    && (a4?.monday_description ?? null) === baseline.description
    && (a4?.po_number ?? null) === baseline.po
    && (a4?.order_name ?? null) === baseline.name)
  check('Monday has no un-reverted edits left', journalSize() === 0, `${journalSize()} pending`)
} catch (error) {
  console.error('\nHARNESS ERROR:', error?.message ?? error)
} finally {
  const left = journalSize()
  if (left > 0) {
    console.log(`\n!! reverting ${left} outstanding Monday edits`)
    await revertAll()
  }
  await closeAll()
}

const passed = results.filter((r) => r.pass).length
console.log(`\n${'='.repeat(58)}`)
console.log(`  ${passed}/${results.length} passed`)
const failed = results.filter((r) => !r.pass)
if (failed.length) {
  console.log('\n  failures:')
  failed.forEach((f) => console.log(`    ${f.n}. ${f.name}  [${f.detail}]`))
}
console.log('='.repeat(58))
