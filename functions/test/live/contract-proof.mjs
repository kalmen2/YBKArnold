// The contract proof: DROP monday_orders entirely, then run the real refresh
// and read cards back. Nothing may depend on the collection existing.
import { refresh, env, closeAll } from './roundtrip-harness.mjs'
import { MongoClient } from 'mongodb'
import { createMondayCardStore } from '../../src/orders/monday-card-store.mjs'
const c = new MongoClient(env.MONGODB_URI); await c.connect()
const src = c.db('arnold_system_orders'), db = c.db('arnold_system_orders_sandbox')
for (const n of ['orders','monday_orders']) {
  const d = await src.collection(n).find({}).toArray()
  await db.collection(n).deleteMany({}); if (d.length) await db.collection(n).insertMany(d)
}
const O = db.collection('orders')
const active = () => O.countDocuments({ is_cancelled:{$ne:true}, is_deleted:{$ne:true} })
let n=0,pass=0; const check=(t,ok,d='')=>{n++;if(ok)pass++;console.log(`  ${ok?'ok  ':'FAIL'} ${n} - ${t}${d?`  [${d}]`:''}`)}

const before = await active()
const sample = await O.find({ 'monday.card': { $exists: true }, monday_production_item_id: { $nin:[null,''] } },
  { projection:{ order_number:1, monday_production_item_id:1, monday:1 } }).limit(6).toArray()
check('orders healthy before', before > 100, `${before}`)
check('sample of embedded cards', sample.length >= 3, `${sample.length}`)

await db.collection('monday_orders').drop().catch(()=>{})
const exists = (await db.listCollections({ name: 'monday_orders' }).toArray()).length
check('monday_orders DROPPED', exists === 0)

const store = createMondayCardStore({ getCollections: async () => ({ ordersUnifiedCollection: O }) })
let served = 0
for (const o of sample) if (await store.findOneCompat({ mondayItemId: o.monday_production_item_id })) served++
check('card reads work with the collection gone', served === sample.length, `${served}/${sample.length}`)
check('bulk read works', (await store.findManyByItemIds(sample.map(o=>o.monday_production_item_id))).length === sample.length)

const w = await store.writeMondayCard({ mondayItemId: sample[0].monday_production_item_id, set: { notes: 'CONTRACT-OK' } })
check('card writes work with the collection gone', w.embeddedCount >= 1, `${w.embeddedCount}`)
check('the write is readable back', (await store.findOneCompat({ mondayItemId: sample[0].monday_production_item_id }))?.notes === 'CONTRACT-OK')

const s = await refresh('no-mirror')
check('a full refresh runs with no mirror', (s?.warnings ?? []).length === 0, (s?.warnings ?? []).join('; ').slice(0,80))
check('refresh merged the usual orders', (s?.mergedOrderCount ?? 0) > 100, `${s?.mergedOrderCount}`)
check('orders survived the refresh', await active() === before, `${await active()} vs ${before}`)
const stillEmbedded = await O.countDocuments({ 'monday.card': { $exists: true } })
check('embedded cards survived the refresh', stillEmbedded > 100, `${stillEmbedded}`)
check('monday_orders was NOT recreated', (await db.listCollections({ name:'monday_orders' }).toArray()).length === 0)

console.log(`\n  ${pass}/${n} passed`)
await c.close(); await closeAll()
