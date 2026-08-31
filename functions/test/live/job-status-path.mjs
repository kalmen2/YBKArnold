// Executes the exact code path that threw "mondayCards is not defined":
// createMondaySyncHelpers -> resolveMondayOrderContext, with real collections.
import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'
import { createMondaySyncHelpers } from '../../src/orders/monday-sync.mjs'
const t = readFileSync(new URL('../../.env', import.meta.url),'utf8')
const e = Object.fromEntries(t.split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const c = new MongoClient(e.MONGODB_URI); await c.connect()
const db = c.db('arnold_system_orders')          // READ-ONLY against production
const O = db.collection('orders')
const getCollections = async () => ({ ordersUnifiedCollection: O, mondayOrdersCollection: db.collection('monday_orders') })

let n=0,pass=0; const check=(t,ok,d='')=>{n++;if(ok)pass++;console.log(`  ${ok?'ok  ':'FAIL'} ${n} - ${t}${d?`  [${d}]`:''}`)}

const helpers = createMondaySyncHelpers({ getCollections })
check('helpers construct', typeof helpers.resolveMondayOrderContext === 'function')

const sample = await O.find({ monday_production_item_id: { $nin:[null,''] }, 'monday.card': { $exists: true } },
  { projection:{ order_number:1, monday_production_item_id:1 } }).limit(5).toArray()
check('found orders to test', sample.length >= 3, `${sample.length}`)

let ok = 0, errors = []
for (const o of sample) {
  try {
    const ctx = await helpers.resolveMondayOrderContext({
      mondayItemId: o.monday_production_item_id,
      mondayOrdersCollection: db.collection('monday_orders'),
      ordersUnifiedCollection: O,
    })
    if (ctx?.boardId && ctx?.mondayItemId) ok++
    else errors.push(`${o.order_number}: no boardId`)
  } catch (err) { errors.push(`${o.order_number}: ${err.message}`) }
}
check('resolveMondayOrderContext works for every sample', ok === sample.length, `${ok}/${sample.length}`)
if (errors.length) errors.slice(0,4).forEach(x=>console.log(`        ${x}`))

const ctx = await helpers.resolveMondayOrderContext({
  mondayItemId: sample[0].monday_production_item_id,
  mondayOrdersCollection: db.collection('monday_orders'), ordersUnifiedCollection: O,
})
check('context carries board + order number', Boolean(ctx.boardId && ctx.orderNumber), `board=${ctx.boardId} order=${ctx.orderNumber}`)
check('context carries progress status details', Array.isArray(ctx.rawProgressStatusDetails), `${ctx.rawProgressStatusDetails?.length} entries`)

console.log(`\n  ${pass}/${n} passed`)
await c.close()
