// After a real refresh, every linked order's embedded card must match the mirror.
import { refresh, env, closeAll } from './roundtrip-harness.mjs'
import { MongoClient } from 'mongodb'
const c = new MongoClient(env.MONGODB_URI); await c.connect()
const src = c.db('arnold_system_orders'), db = c.db('arnold_system_orders_sandbox')
for (const n of ['orders','monday_orders']) {
  const docs = await src.collection(n).find({}).toArray()
  await db.collection(n).deleteMany({}); if (docs.length) await db.collection(n).insertMany(docs)
}
const O = db.collection('orders'), M = db.collection('monday_orders')
console.log(`before: orders with monday.card = ${await O.countDocuments({ 'monday.card': { $exists: true } })}`)

await refresh('embed-sync')

const withCard = await O.countDocuments({ 'monday.card': { $exists: true } })
console.log(`after : orders with monday.card = ${withCard}`)

const linkedOrders = await O.find({ monday_production_item_id: { $nin: [null,''] } },
  { projection: { order_number:1, monday_production_item_id:1, monday:1 } }).toArray()
let checked = 0, drift = 0
const FIELDS = ['statusLabel','orderName','jobNumber','notes','description','poNumber','dueDate','mondayBoardId']
for (const o of linkedOrders) {
  const m = await M.findOne({ mondayItemId: o.monday_production_item_id })
  if (!m) continue
  checked++
  const card = o.monday?.card ?? {}
  for (const f of FIELDS) {
    const a = m[f] ?? null, b = card[f] ?? null
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      if (drift < 6) console.log(`  DRIFT ${o.order_number} ${f}: mirror=${JSON.stringify(a)} embedded=${JSON.stringify(b)}`)
      drift++
    }
  }
}
console.log(`\nlinked orders checked : ${checked}`)
console.log(`field mismatches      : ${drift}`)
console.log(drift === 0 ? 'IN SYNC - the embedded copy tracks the mirror through a refresh' : 'OUT OF SYNC')
await c.close(); await closeAll()
