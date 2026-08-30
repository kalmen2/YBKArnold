// Proves the expand step: a card write lands in BOTH monday_orders and
// orders.monday.card, against a real sandbox database.
import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'
import { createMondayCardStore } from '../../src/orders/monday-card-store.mjs'

const t = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
const e = Object.fromEntries(t.split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const c = new MongoClient(e.MONGODB_URI); await c.connect()
const src = c.db('arnold_system_orders'), db = c.db('arnold_system_orders_sandbox')
for (const n of ['orders','monday_orders']) {
  const docs = await src.collection(n).find({}).toArray()
  await db.collection(n).deleteMany({}); if (docs.length) await db.collection(n).insertMany(docs)
}
const getCollections = async () => ({
  ordersUnifiedCollection: db.collection('orders'),
  mondayOrdersCollection: db.collection('monday_orders'),
})
const store = createMondayCardStore({ getCollections })
const O = db.collection('orders'), M = db.collection('monday_orders')

let n = 0, pass = 0
const check = (name, ok, detail='') => { n++; if (ok) pass++; console.log(`  ${ok?'ok  ':'FAIL'} ${n} - ${name}${detail?`  [${detail}]`:''}`) }

const linked = await O.findOne({ monday_production_item_id: { $nin: [null,''] } })
const id = linked.monday_production_item_id
const STAMP = 'DW' + Date.now().toString().slice(-6)

await store.updateOneCompat({ mondayItemId: id }, { $set: { notes: STAMP, bench: `${STAMP}-B` } })
const m1 = await M.findOne({ mondayItemId: id })
const o1 = await O.findOne({ monday_production_item_id: id })
check('mirror got the write', m1?.notes === STAMP, m1?.notes)
check('embedded copy got the same write', o1?.monday?.card?.notes === STAMP, o1?.monday?.card?.notes)
check('multiple fields mirror together', o1?.monday?.card?.bench === `${STAMP}-B`)
check('the two copies agree', m1?.notes === o1?.monday?.card?.notes)

const before = await M.countDocuments({})
await store.updateOneCompat({ mondayItemId: '999999999999' }, { $set: { notes: 'orphan' } })
check('an unlinked card still reaches the mirror', await M.countDocuments({}) === before, 'no upsert without the flag')

const r = await store.writeMondayCard({ mondayItemId: id, set: { statusLabel: `${STAMP}-S` } })
const o2 = await O.findOne({ monday_production_item_id: id })
check('writeMondayCard reports the owning order count', r.embeddedCount >= 1, `${r.embeddedCount}`)
check('writeMondayCard embeds too', o2?.monday?.card?.statusLabel === `${STAMP}-S`)

const card = await store.readMondayCard({ mondayItemId: id })
check('read prefers the embedded value', card?.notes === STAMP, card?.notes)
check('read still exposes mirror-only fields', Boolean(card?.mondayBoardId), card?.mondayBoardId)

const unlinkedCard = await store.readMondayCard({ mondayItemId: (await M.findOne({ mondayItemId: { $nin: [id] } }))?.mondayItemId })
check('read works for a card with no owning order', unlinkedCard !== null)

console.log(`\n  ${pass}/${n} passed`)
await c.close()
