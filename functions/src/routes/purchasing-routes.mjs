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
      const limit = Math.min(Math.max(Number(req.query?.limit) || 200, 1), 1000)
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
        .limit(limit)
        .toArray()

      return res.json({
        generatedAt: new Date().toISOString(),
        count: items.length,
        items,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/purchasing/items/:itemKey', requireFirebaseAuth, async (req, res, next) => {
    try {
      const itemKey = String(req.params?.itemKey ?? '').trim().toLowerCase()
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

      // Build per-vendor breakdown with shipping stats
      const byVendor = new Map()
      let grandSpent = 0
      let grandQty = 0

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
          poCount: 0,
          receiptCount: 0,
        }

        const amount = toNumber(tx.amount)
        const qty = toNumber(tx.qty)
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

        grandSpent = toMoney(grandSpent + amount)
        grandQty = toNumber(grandQty + qty)

        byVendor.set(vendorKey, existing)
      })

      const vendors = [...byVendor.values()].map((v) => {
        const list = v.shipDaysList
        const fastest = list.length ? Math.min(...list) : null
        const slowest = list.length ? Math.max(...list) : null
        const average = list.length
          ? Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(1))
          : null
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
        },
        vendors,
        transactions,
      })
    } catch (error) {
      next(error)
    }
  })
}
