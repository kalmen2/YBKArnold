// The contract test: with monday_orders EMPTIED, do the converted reads still
// return card data from the embedded copy? This is what "we can delete the
// collection" actually means.
import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'
import { createMondayCardStore } from '../../src/orders/monday-card-store.mjs'
const t = readFileSync(new URL('../../.env', import.meta.url),'utf8')
const e = Object.fromEntries(t.split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const c = new MongoClient(e.MONGODB_URI); await c.connect()
const src = c.db('arnold_system_orders'), db = c.db('arnold_system_orders_sandbox')
for (const n of ['orders','monday_orders']) {
  const docs = await src.collection(n).find({}).toArray()
  await db.collection(n).deleteMany({}); if (docs.length) await db.collection(n).insertMany(docs)
}
const O = db.collection('orders'), M = db.collection('monday_orders')
const store = createMondayCardStore({ getCollections: async () => ({ ordersUnifiedCollection: O, mondayOrdersCollection: M }) })

let n=0, pass=0
const check=(name,ok,d='')=>{n++;if(ok)pass++;console.log(`  ${ok?'ok  ':'FAIL'} ${n} - ${name}${d?`  [${d}]`:''}`)}

const linked = await O.find({ 'monday.card': { $exists: true }, monday_production_item_id: { $nin:[null,''] } },
  { projection:{ order_number:1, monday_production_item_id:1 } }).limit(5).toArray()
check('sample of linked orders with embedded cards', linked.length >= 3, `${linked.length}`)

const before = []
for (const o of linked) before.push(await store.findOneCompat({ mondayItemId: o.monday_production_item_id }))
check('reads work while the mirror is present', before.every(Boolean))

// now empty the mirror entirely
const removed = await M.deleteMany({})
check('mirror emptied', await M.countDocuments({}) === 0, `${removed.deletedCount} removed`)

let served = 0, lostFields = 0
for (let i=0;i<linked.length;i++) {
  const after = await store.findOneCompat({ mondayItemId: linked[i].monday_production_item_id })
  if (after) served++
  for (const f of ['statusLabel','orderName','jobNumber','notes','poNumber']) {
    if ((before[i]?.[f] ?? null) !== (after?.[f] ?? null)) lostFields++
  }
}
check('every read still returns a card with no mirror at all', served === linked.length, `${served}/${linked.length}`)
check('no card fields were lost', lostFields === 0, `${lostFields} differ`)

const bulk = await store.findManyByItemIds(linked.map(o=>o.monday_production_item_id))
check('bulk read works with no mirror', bulk.length === linked.length, `${bulk.length}/${linked.length}`)

const unlinked = await store.findOneCompat({ mondayItemId: '999999999999' })
check('an unlinked card returns nothing once the mirror is gone', unlinked === null || unlinked === undefined)

console.log(`\n  ${pass}/${n} passed`)
await c.close()
