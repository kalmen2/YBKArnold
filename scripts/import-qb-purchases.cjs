/* Importer: read QB Desktop xlsx exports → MongoDB purchasing collections.
 * Run from repo root:  node scripts/import-qb-purchases.cjs
 */
const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')
const crypto = require('crypto')

require('dotenv').config({ path: path.resolve(__dirname, '..', 'functions', '.env') })

const { MongoClient } = require(path.resolve(__dirname, '..', 'functions', 'node_modules', 'mongodb'))

const DATA_DIR = path.resolve(__dirname, '..', 'functions', 'data-qb')
const FILES = {
  itemReceiptsByVendor: 'Book2.xlsm', // Item Receipts grouped by vendor
  purchaseOrders: 'Book3.xlsm', // Flat PO list with Ship/Deliv dates
  itemDetail: 'Purchase Detail 5-1-26.xlsx', // Item-grouped purchase history
}

const MONGO_URI = process.env.MONGODB_URI
const MONGO_DB = process.env.MONGODB_DB || 'arnold_system'
if (!MONGO_URI) {
  console.error('Missing MONGODB_URI in functions/.env')
  process.exit(1)
}

function normKey(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function toMoney(n) {
  const x = Number(String(n ?? '').replace(/,/g, ''))
  return Number.isFinite(x) ? Number(x.toFixed(2)) : 0
}

function toQty(n) {
  const x = Number(String(n ?? '').replace(/,/g, ''))
  return Number.isFinite(x) ? x : 0
}

function toDateString(value) {
  if (!value) return null
  const s = String(value).trim()
  if (!s) return null
  // value like 11/24/2025 or 11/24/2025 11:38:00
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) {
    const mo = m[1].padStart(2, '0')
    const d = m[2].padStart(2, '0')
    let y = m[3]
    if (y.length === 2) y = '20' + y
    return `${y}-${mo}-${d}`
  }
  // try Date parse fallback
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  return null
}

function diffDays(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const a = Date.parse(fromIso + 'T00:00:00Z')
  const b = Date.parse(toIso + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  const days = Math.round((b - a) / 86400000)
  return days
}

function readSheet(file) {
  const full = path.join(DATA_DIR, file)
  if (!fs.existsSync(full)) throw new Error('Missing file: ' + full)
  const wb = XLSX.readFile(full)
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase().startsWith('sheet')) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null })
}

function buildHeaderIndex(headerRow) {
  const map = {}
  ;(headerRow || []).forEach((cell, i) => {
    if (cell == null) return
    map[String(cell).trim()] = i
  })
  return map
}

/* ---------- Book3: flat Purchase Orders with Ship/Deliv ---------- */
function parsePurchaseOrders(rows) {
  const header = rows[0] || []
  const idx = buildHeaderIndex(header)
  const out = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r) continue
    const type = r[idx['Type']]
    if (!type || String(type).trim() !== 'Purchase Order') continue
    const date = toDateString(r[idx['Date']])
    const poNumber = r[idx['Num']] != null ? String(r[idx['Num']]).trim() : null
    const vendorRaw = r[idx['Name']] != null ? String(r[idx['Name']]).trim() : null
    const shipDate = toDateString(r[idx['Ship Date']])
    const delivDate = toDateString(r[idx['Deliv Date']])
    const memo = r[idx['Memo']] != null ? String(r[idx['Memo']]).trim() : null
    const itemRaw = r[idx['Item']] != null ? String(r[idx['Item']]).trim() : null
    const itemDescription = r[idx['Item Description']] != null ? String(r[idx['Item Description']]).trim() : null
    const qty = toQty(r[idx['Qty']])
    const unitCost = toMoney(r[idx['Cost Price']])
    const amount = toMoney(r[idx['Amount']])
    out.push({
      type: 'Purchase Order',
      date,
      poNumber,
      vendorRaw,
      shipDate,
      delivDate,
      memo,
      itemRaw,
      itemDescription,
      qty,
      unitCost,
      amount,
      source: 'Book3.xlsm',
    })
  }
  return out
}

/* ---------- Book2: Item Receipts grouped by vendor ---------- */
function parseItemReceiptsByVendor(rows) {
  const header = rows[0] || []
  const idx = buildHeaderIndex(header)
  // Vendor groups are identifiable by col B (index 1) holding a non-empty
  // value while Type/Date/Item cells are empty. "Total ..." rows close.
  const out = []
  let currentVendor = null
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r) continue
    const colB = r[1] != null ? String(r[1]).trim() : ''
    const type = r[idx['Type']] != null ? String(r[idx['Type']]).trim() : ''
    if (colB && !type) {
      if (/^Total\b/i.test(colB)) {
        currentVendor = null
      } else {
        currentVendor = colB
      }
      continue
    }
    if (!type) continue
    const date = toDateString(r[idx['Date']])
    const sourceName = r[idx['Source Name']] != null ? String(r[idx['Source Name']]).trim() : null
    const vendorRaw = sourceName || currentVendor || null
    const memo = r[idx['Memo']] != null ? String(r[idx['Memo']]).trim() : null
    const itemRaw = r[idx['Item']] != null ? String(r[idx['Item']]).trim() : null
    const itemDescription = r[idx['Item Description']] != null ? String(r[idx['Item Description']]).trim() : null
    const qty = toQty(r[idx['Qty']])
    const unitCost = toMoney(r[idx['Cost Price']])
    const amount = toMoney(r[idx['Amount']])
    const shipDate = toDateString(r[idx['Ship Date']])
    const delivDate = toDateString(r[idx['Deliv Date']])
    const transNum = r[idx['Trans #']] != null ? String(r[idx['Trans #']]).trim() : null
    out.push({
      type: type || 'Item Receipt',
      date,
      // The receipt's own Trans # is NOT the source PO number. Treating it as a
      // PO# caused spurious matches against Book3 (e.g. Trans 75 ↔ PO 75) and
      // produced fake 0-day ship-time calculations. Set poNumber to null until
      // a re-export adds a real "P. O. #" column on the Item Receipt report.
      poNumber: null,
      transNumber: transNum,
      vendorRaw,
      memo,
      itemRaw,
      itemDescription,
      qty,
      unitCost,
      amount,
      shipDate,
      delivDate,
      source: 'Book2.xlsm',
    })
  }
  return out
}

/* ---------- Purchase Detail: Item-grouped purchase history ---------- */
function parseItemDetail(rows) {
  const header = rows[0] || []
  const idx = buildHeaderIndex(header)
  // Item groups identifiable by col C (index 2) text while Type cell empty.
  const out = []
  let currentItem = null
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r) continue
    const colC = r[2] != null ? String(r[2]).trim() : ''
    const type = r[idx['Type']] != null ? String(r[idx['Type']]).trim() : ''
    if (colC && !type) {
      if (/^Total\b/i.test(colC)) {
        currentItem = null
      } else {
        currentItem = colC
      }
      continue
    }
    if (!type) continue
    const date = toDateString(r[idx['Date']])
    const num = r[idx['Num']] != null ? String(r[idx['Num']]).trim() : null
    const memo = r[idx['Memo']] != null ? String(r[idx['Memo']]).trim() : null
    const vendorRaw = r[idx['Source Name']] != null ? String(r[idx['Source Name']]).trim() : null
    const itemRawCell = r[idx['Item']] != null ? String(r[idx['Item']]).trim() : null
    const itemRaw = itemRawCell || currentItem
    const itemDescription = r[idx['Item Description']] != null ? String(r[idx['Item Description']]).trim() : null
    const qty = toQty(r[idx['Qty']])
    const unitCost = toMoney(r[idx['Cost Price']])
    const amount = toMoney(r[idx['Amount']])
    out.push({
      type,
      date,
      poNumber: num,
      vendorRaw,
      memo,
      itemRaw,
      itemDescription,
      qty,
      unitCost,
      amount,
      shipDate: null,
      delivDate: null,
      source: 'Purchase Detail 5-1-26.xlsx',
    })
  }
  return out
}

function deterministicId(...parts) {
  const h = crypto.createHash('sha1')
  h.update(parts.map((p) => String(p ?? '')).join('||'))
  return h.digest('hex').slice(0, 24)
}

async function main() {
  console.log('Reading XLSX files...')
  const poRows = parsePurchaseOrders(readSheet(FILES.purchaseOrders))
  console.log('  Purchase Orders rows:', poRows.length)
  const receiptRows = parseItemReceiptsByVendor(readSheet(FILES.itemReceiptsByVendor))
  console.log('  Item Receipts rows:', receiptRows.length)
  const detailRows = parseItemDetail(readSheet(FILES.itemDetail))
  console.log('  Purchase Detail rows:', detailRows.length)

  // Build PO ship/deliv lookup by PO number (Book3 Num)
  const poShipByNumber = new Map()
  poRows.forEach((p) => {
    if (!p.poNumber) return
    const key = String(p.poNumber).trim()
    const existing = poShipByNumber.get(key)
    if (!existing) {
      poShipByNumber.set(key, {
        poDate: p.date,
        shipDate: p.shipDate,
        delivDate: p.delivDate,
        vendorRaw: p.vendorRaw,
      })
    }
  })

  const allTx = [...poRows, ...receiptRows, ...detailRows]
    .filter((t) => t.itemRaw)
    .map((t, idx) => {
      // Enrich with PO ship/deliv if we have a PO number match (but tx isn't PO itself)
      let shipDate = t.shipDate
      let delivDate = t.delivDate
      let poDate = t.type === 'Purchase Order' ? t.date : null
      if (t.poNumber) {
        const lookup = poShipByNumber.get(String(t.poNumber).trim())
        if (lookup) {
          if (!shipDate) shipDate = lookup.shipDate
          if (!delivDate) delivDate = lookup.delivDate
          if (!poDate) poDate = lookup.poDate
        }
      }
      const fromDate = poDate || t.date
      const shipDays = diffDays(fromDate, delivDate)
      const itemKey = normKey(t.itemRaw)
      const vendorKey = normKey(t.vendorRaw)
      const id = deterministicId(idx, t.source, t.type, t.date, t.poNumber, itemKey, vendorKey, t.qty, t.amount, t.memo)
      return {
        id,
        source: t.source,
        type: t.type,
        date: t.date,
        poDate,
        poNumber: t.poNumber,
        transNumber: t.transNumber || null,
        itemKey,
        itemRaw: t.itemRaw,
        itemDescription: t.itemDescription,
        vendorKey,
        vendorRaw: t.vendorRaw,
        qty: t.qty,
        unitCost: t.unitCost,
        amount: t.amount,
        memo: t.memo,
        shipDate,
        delivDate,
        shipDays,
      }
    })

  console.log('Total transactions:', allTx.length)

  // Build item rollups from receipts + detail (skip POs to avoid double-counting spend;
  // POs still contribute shipping stats via lookup but item-level history is from receipts/details)
  const items = new Map()
  allTx.forEach((t) => {
    if (!t.itemKey) return
    const isSpend = t.type === 'Item Receipt' || t.type === 'Bill' || t.type === 'Check' || t.type === 'Credit Card Charge'
    const it = items.get(t.itemKey) || {
      itemKey: t.itemKey,
      itemRaw: t.itemRaw,
      descriptions: new Set(),
      vendorRaws: new Set(),
      vendorKeys: new Set(),
      totalSpent: 0,
      totalQty: 0,
      transactionCount: 0,
      firstPurchaseDate: null,
      lastPurchaseDate: null,
    }
    if (t.itemRaw && t.itemRaw.length > (it.itemRaw || '').length) it.itemRaw = t.itemRaw
    if (t.itemDescription) it.descriptions.add(t.itemDescription)
    if (t.vendorRaw) it.vendorRaws.add(t.vendorRaw)
    if (t.vendorKey) it.vendorKeys.add(t.vendorKey)
    if (isSpend) {
      it.totalSpent = Number((it.totalSpent + Number(t.amount || 0)).toFixed(2))
      it.totalQty = it.totalQty + Number(t.qty || 0)
    }
    it.transactionCount += 1
    if (t.date) {
      if (!it.firstPurchaseDate || t.date < it.firstPurchaseDate) it.firstPurchaseDate = t.date
      if (!it.lastPurchaseDate || t.date > it.lastPurchaseDate) it.lastPurchaseDate = t.date
    }
    items.set(t.itemKey, it)
  })

  const itemDocs = [...items.values()].map((it) => ({
    itemKey: it.itemKey,
    itemRaw: it.itemRaw,
    descriptions: [...it.descriptions].slice(0, 20),
    vendorRaws: [...it.vendorRaws],
    vendorKeys: [...it.vendorKeys],
    vendorCount: it.vendorKeys.size,
    totalSpent: it.totalSpent,
    totalQty: Number(it.totalQty.toFixed(3)),
    transactionCount: it.transactionCount,
    firstPurchaseDate: it.firstPurchaseDate,
    lastPurchaseDate: it.lastPurchaseDate,
    updatedAt: new Date().toISOString(),
  }))

  console.log('Distinct items:', itemDocs.length)

  console.log('Connecting to MongoDB...')
  const client = new MongoClient(MONGO_URI)
  await client.connect()
  try {
    const db = client.db(MONGO_DB)
    const txCol = db.collection('purchasing_transactions')
    const itCol = db.collection('purchasing_items')

    console.log('Clearing existing purchasing data...')
    await txCol.deleteMany({})
    await itCol.deleteMany({})

    if (allTx.length) {
      const chunkSize = 1000
      for (let i = 0; i < allTx.length; i += chunkSize) {
        const chunk = allTx.slice(i, i + chunkSize)
        await txCol.insertMany(chunk, { ordered: false }).catch((err) => {
          if (err && err.code === 11000) return
          throw err
        })
        process.stdout.write(`  inserted tx ${Math.min(i + chunkSize, allTx.length)}/${allTx.length}\r`)
      }
      console.log('')
    }

    if (itemDocs.length) {
      const chunkSize = 500
      for (let i = 0; i < itemDocs.length; i += chunkSize) {
        const chunk = itemDocs.slice(i, i + chunkSize)
        await itCol.insertMany(chunk, { ordered: false })
        process.stdout.write(`  inserted items ${Math.min(i + chunkSize, itemDocs.length)}/${itemDocs.length}\r`)
      }
      console.log('')
    }

    // Ensure indexes (collections may be brand new)
    await itCol.createIndex({ itemKey: 1 }, { unique: true })
    await itCol.createIndex({ totalSpent: -1 })
    await itCol.createIndex({ lastPurchaseDate: -1 })
    await itCol.createIndex(
      { itemRaw: 'text', descriptions: 'text', vendorRaws: 'text' },
      { name: 'purchasing_items_text', weights: { itemRaw: 10, descriptions: 5, vendorRaws: 3 } },
    ).catch(() => {})
    await txCol.createIndex({ id: 1 }, { unique: true })
    await txCol.createIndex({ itemKey: 1, date: -1 })
    await txCol.createIndex({ vendorKey: 1, date: -1 })
    await txCol.createIndex({ poNumber: 1 }, { sparse: true })

    console.log('Done.')
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
