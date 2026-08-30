// Does deleting the unlinked mirror rows stick, or does the next refresh
// recreate them from the Monday boards?
import { refresh, env, closeAll } from './roundtrip-harness.mjs'
import { MongoClient } from 'mongodb'
const c = new MongoClient(env.MONGODB_URI); await c.connect()
const src = c.db('arnold_system_orders'), db = c.db('arnold_system_orders_sandbox')
for (const n of ['orders','monday_orders']) {
  const d = await src.collection(n).find({}).toArray()
  await db.collection(n).deleteMany({}); if (d.length) await db.collection(n).insertMany(d)
}
const O = db.collection('orders'), M = db.collection('monday_orders')
const orders = await O.find({},{projection:{monday_item_id:1,monday_production_item_id:1,monday_financial_item_id:1}}).toArray()
const linked = new Set()
for (const o of orders) for (const f of ['monday_item_id','monday_production_item_id','monday_financial_item_id']) { const v=String(o[f]??'').trim(); if(v) linked.add(v) }
const doomed = (await M.find({},{projection:{mondayItemId:1}}).toArray())
  .filter(m=>!linked.has(String(m.mondayItemId??'').trim())).map(m=>m.mondayItemId)

const active = () => O.countDocuments({ is_cancelled:{$ne:true}, is_deleted:{$ne:true} })
console.log(`start        : orders=${await active()}  monday_orders=${await M.countDocuments({})}`)
await M.deleteMany({ mondayItemId: { $in: doomed } })
console.log(`after delete : orders=${await active()}  monday_orders=${await M.countDocuments({})}  (removed ${doomed.length})`)
await refresh('post-delete')
const after = await M.countDocuments({})
console.log(`after refresh: orders=${await active()}  monday_orders=${after}`)
const regenerated = await M.countDocuments({ mondayItemId: { $in: doomed } })
console.log(`\nregenerated unlinked rows: ${regenerated}`)
console.log(regenerated === 0 ? 'DURABLE - the delete sticks' : 'NOT DURABLE - refresh recreates them')
await c.close(); await closeAll()
