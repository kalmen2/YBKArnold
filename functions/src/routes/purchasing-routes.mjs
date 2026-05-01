export function registerPurchasingRoutes(app, deps) {
  const { getCollections, requireFirebaseAuth } = deps

  function toMoney(value) {
    const n = Number(value)
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
  }

  function toNumber(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }

  function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  app.get('/api/purchasing/items', requireFirebaseAuth, async (req, res, next) => {
    try {
      const search = String(req.query?.search ?? '').trim()
      const pageSize = Math.min(Math.max(Number(req.query?.pageSize) || 100, 1), 500)
      const page = Math.max(Number(req.query?.page) || 1, 1)
      const { purchasingItemsCollection } = await getCollections()

      const filter = {}

      if (search) {
        const safe = escapeRegExp(search)
        const rx = new RegExp(safe, 'i')
        filter.$or = [
          { itemRaw: rx },
          { descriptions: rx },
          { vendorRaws: rx },
        ]
      }

      const totalCount = await purchasingItemsCollection.countDocuments(filter)
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
      const safePage = Math.min(page, totalPages)

      const items = await purchasingItemsCollection
        .find(filter, {
          projection: {
            _id: 0,
            itemKey: 1,
            itemRaw: 1,
            descriptions: 1,
            totalSpent: 1,
            totalQty: 1,
            transactionCount: 1,
            vendorCount: 1,
            vendorRaws: 1,
            firstPurchaseDate: 1,
            lastPurchaseDate: 1,
          },
        })
        .sort({ totalSpent: -1, lastPurchaseDate: -1 })
        .skip((safePage - 1) * pageSize)
        .limit(pageSize)
        .toArray()

      return res.json({
        generatedAt: new Date().toISOString(),
        page: safePage,
        pageSize,
        totalPages,
        totalCount,
        count: items.length,
        items,
      })
    } catch (error) {
      next(error)
    }
  })

  // Detail lookup uses a query param so itemKeys containing '/', '(', '"', etc.
  // are not split or rejected by URL path normalization (Firebase Hosting decodes
  // %2F back to '/', which breaks `:itemKey` segment matching).
  async function purchasingItemDetailHandler(req, res, next) {
    try {
      const rawKey = req.query?.key ?? req.params?.itemKey ?? ''
      const itemKey = String(rawKey).trim().toLowerCase()
      if (!itemKey) {
        return res.status(400).json({ error: 'itemKey is required.' })
      }

      const { purchasingItemsCollection, purchasingTransactionsCollection } = await getCollections()
      const item = await purchasingItemsCollection.findOne(
        { itemKey },
        { projection: { _id: 0 } },
      )

      if (!item) {
        return res.status(404).json({ error: 'Item not found.' })
      }

      const transactions = await purchasingTransactionsCollection
        .find({ itemKey }, { projection: { _id: 0 } })
        .sort({ date: -1 })
        .toArray()

      // Build per-vendor breakdown with shipping + price stats
      const byVendor = new Map()
      let grandSpent = 0
      let grandQty = 0
      const grandPriceList = []

      transactions.forEach((tx) => {
        const vendorKey = tx.vendorKey || 'unknown'
        const existing = byVendor.get(vendorKey) || {
          vendorKey,
          vendorRaw: tx.vendorRaw || vendorKey,
          totalSpent: 0,
          totalQty: 0,
          transactionCount: 0,
          firstPurchaseDate: null,
          lastPurchaseDate: null,
          shipDaysList: [],
          unitPriceList: [],
          poCount: 0,
          receiptCount: 0,
        }

        const amount = toNumber(tx.amount)
        const qty = toNumber(tx.qty)
        const unit = toNumber(tx.unitCost)
        existing.totalSpent = toMoney(existing.totalSpent + amount)
        existing.totalQty = toNumber(existing.totalQty + qty)
        existing.transactionCount += 1
        if (tx.type === 'Purchase Order') existing.poCount += 1
        if (tx.type === 'Item Receipt') existing.receiptCount += 1

        if (tx.date) {
          if (!existing.firstPurchaseDate || tx.date < existing.firstPurchaseDate) {
            existing.firstPurchaseDate = tx.date
          }
          if (!existing.lastPurchaseDate || tx.date > existing.lastPurchaseDate) {
            existing.lastPurchaseDate = tx.date
          }
        }

        if (Number.isFinite(Number(tx.shipDays)) && Number(tx.shipDays) >= 0) {
          existing.shipDaysList.push(Number(tx.shipDays))
        }

        // Only count actual purchase lines for price stats: must have a real
        // qty and unit cost. Skips PO header rows, freight/tax write-ins with
        // qty 0, and zero-cost lines.
        if (qty > 0 && unit > 0) {
          existing.unitPriceList.push(unit)
          grandPriceList.push(unit)
        }

        grandSpent = toMoney(grandSpent + amount)
        grandQty = toNumber(grandQty + qty)

        byVendor.set(vendorKey, existing)
      })

      function priceStats(list) {
        if (!list.length) return { highest: null, lowest: null, average: null, sampleCount: 0 }
        const highest = Math.max(...list)
        const lowest = Math.min(...list)
        const average = list.reduce((a, b) => a + b, 0) / list.length
        return {
          highest: Number(highest.toFixed(4)),
          lowest: Number(lowest.toFixed(4)),
          average: Number(average.toFixed(4)),
          sampleCount: list.length,
        }
      }

      const vendors = [...byVendor.values()].map((v) => {
        const list = v.shipDaysList
        const fastest = list.length ? Math.min(...list) : null
        const slowest = list.length ? Math.max(...list) : null
        const average = list.length
          ? Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(1))
          : null
        const ps = priceStats(v.unitPriceList)
        return {
          vendorKey: v.vendorKey,
          vendorRaw: v.vendorRaw,
          totalSpent: v.totalSpent,
          totalQty: v.totalQty,
          transactionCount: v.transactionCount,
          poCount: v.poCount,
          receiptCount: v.receiptCount,
          firstPurchaseDate: v.firstPurchaseDate,
          lastPurchaseDate: v.lastPurchaseDate,
          fastestShipDays: fastest,
          slowestShipDays: slowest,
          averageShipDays: average,
          shipSampleCount: list.length,
          highestPrice: ps.highest,
          lowestPrice: ps.lowest,
          averagePrice: ps.average,
          priceSampleCount: ps.sampleCount,
        }
      }).sort((a, b) => b.totalSpent - a.totalSpent)

      // overall ship stats across vendors
      const allShip = transactions
        .map((t) => Number(t.shipDays))
        .filter((n) => Number.isFinite(n) && n >= 0)
      const overallFastest = allShip.length ? Math.min(...allShip) : null
      const overallSlowest = allShip.length ? Math.max(...allShip) : null
      const overallAvg = allShip.length
        ? Number((allShip.reduce((a, b) => a + b, 0) / allShip.length).toFixed(1))
        : null

      const overallPrice = priceStats(grandPriceList)

      return res.json({
        generatedAt: new Date().toISOString(),
        item,
        summary: {
          totalSpent: grandSpent,
          totalQty: grandQty,
          transactionCount: transactions.length,
          vendorCount: vendors.length,
          fastestShipDays: overallFastest,
          slowestShipDays: overallSlowest,
          averageShipDays: overallAvg,
          shipSampleCount: allShip.length,
          highestPrice: overallPrice.highest,
          lowestPrice: overallPrice.lowest,
          averagePrice: overallPrice.average,
          priceSampleCount: overallPrice.sampleCount,
        },
        vendors,
        transactions,
      })
    } catch (error) {
      next(error)
    }
  }

  app.get('/api/purchasing/items/detail', requireFirebaseAuth, purchasingItemDetailHandler)
  app.get('/api/purchasing/items/:itemKey', requireFirebaseAuth, purchasingItemDetailHandler)
}
