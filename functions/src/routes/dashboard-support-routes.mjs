export function registerDashboardSupportRoutes(app, deps) {
  const {
    clearSupportSnapshotCache,
    createZendeskSupportTicket,
    fetchMondayDashboardSnapshot,
    fetchZendeskSupportAlertTicketsSnapshot,
    fetchZendeskSupportAlerts,
    fetchZendeskSupportTicketsSnapshot,
    fetchZendeskTicketConversation,
    fetchZendeskTicketSummary,
    getCollections,
    getDashboardSnapshotFromCache,
    isDashboardRefreshRequested,
    persistNewMondayOrders,
    setDashboardSnapshotCache,
    toBoundedInteger,
  } = deps

  function sanitizeDownloadFileName(value, fallbackFileName = 'shop-drawing.pdf') {
    const normalized = String(value ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-')

    if (!normalized) {
      return fallbackFileName
    }

    return normalized
  }

  function ensurePdfFileName(value, fallbackFileName = 'shop-drawing.pdf') {
    const safeFileName = sanitizeDownloadFileName(value, fallbackFileName)

    if (/\.pdf$/i.test(safeFileName)) {
      return safeFileName
    }

    return `${safeFileName}.pdf`
  }

  async function loadShopDrawingCacheByOrderId(orderIds) {
    const normalizedOrderIds = [
      ...new Set(
        (Array.isArray(orderIds) ? orderIds : [])
          .map((value) => String(value ?? '').trim())
          .filter((value) => Boolean(value)),
      ),
    ]

    if (normalizedOrderIds.length === 0) {
      return new Map()
    }

    const { mondayOrdersCollection } = await getCollections()
    const orderDocuments = await mondayOrdersCollection
      .find(
        {
          mondayItemId: {
            $in: normalizedOrderIds,
          },
        },
        {
          projection: {
            _id: 0,
            mondayItemId: 1,
            shopDrawingDownloadUrl: 1,
            shopDrawingFileName: 1,
          },
        },
      )
      .toArray()

    return new Map(
      orderDocuments
        .map((orderDocument) => {
          const mondayItemId = String(orderDocument?.mondayItemId ?? '').trim()

          if (!mondayItemId) {
            return null
          }

          return [
            mondayItemId,
            {
              cachedUrl: String(orderDocument?.shopDrawingDownloadUrl ?? '').trim() || null,
              fileName: String(orderDocument?.shopDrawingFileName ?? '').trim() || null,
            },
          ]
        })
        .filter((entry) => entry !== null),
    )
  }

  function enrichOrdersWithShopDrawingCache(orders, cacheByOrderId) {
    if (!Array.isArray(orders) || orders.length === 0) {
      return Array.isArray(orders) ? orders : []
    }

    return orders.map((order) => {
      const orderId = String(order?.id ?? '').trim()

      if (!orderId) {
        return order
      }

      const cachedEntry = cacheByOrderId.get(orderId)
      const cachedUrl = String(cachedEntry?.cachedUrl ?? '').trim() || null

      if (!cachedUrl) {
        return order
      }

      return {
        ...order,
        shopDrawingCachedUrl: cachedUrl,
        shopDrawingFileName:
          String(cachedEntry?.fileName ?? '').trim()
          || String(order?.shopDrawingFileName ?? '').trim()
          || null,
      }
    })
  }

  function enrichMondaySnapshotWithShopDrawingCache(snapshot, cacheByOrderId) {
    const details = snapshot?.details ?? {}

    return {
      ...snapshot,
      orders: enrichOrdersWithShopDrawingCache(snapshot?.orders, cacheByOrderId),
      details: {
        ...details,
        lateOrders: enrichOrdersWithShopDrawingCache(details.lateOrders, cacheByOrderId),
        dueSoonOrders: enrichOrdersWithShopDrawingCache(details.dueSoonOrders, cacheByOrderId),
        activeOrders: enrichOrdersWithShopDrawingCache(details.activeOrders, cacheByOrderId),
        completedOrders: enrichOrdersWithShopDrawingCache(details.completedOrders, cacheByOrderId),
        missingDueDateOrders: enrichOrdersWithShopDrawingCache(
          details.missingDueDateOrders,
          cacheByOrderId,
        ),
      },
    }
  }


app.get('/api/dashboard/monday', async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    let snapshot = null

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache('monday')

      if (cachedSnapshot) {
        snapshot = cachedSnapshot
      }
    }

    if (!snapshot) {
      snapshot = await fetchMondayDashboardSnapshot()
    }

    if (refreshRequested) {
      await persistNewMondayOrders(snapshot)
    }

    const shopDrawingCacheByOrderId = await loadShopDrawingCacheByOrderId(
      Array.isArray(snapshot?.orders)
        ? snapshot.orders.map((order) => order?.id)
        : [],
    )
    const enrichedSnapshot = enrichMondaySnapshotWithShopDrawingCache(
      snapshot,
      shopDrawingCacheByOrderId,
    )

    await setDashboardSnapshotCache('monday', enrichedSnapshot)

    res.json(enrichedSnapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/dashboard/monday/shop-drawing/download', async (req, res, next) => {
  try {
    const orderId = String(req.query?.orderId ?? '').trim()
    const renderInline = String(req.query?.inline ?? '').trim() === '1'

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required.' })
    }

    async function loadOrderDrawingDocument() {
      const { mondayOrdersCollection } = await getCollections()

      return mondayOrdersCollection.findOne(
        {
          mondayItemId: orderId,
        },
        {
          projection: {
            _id: 0,
            mondayItemId: 1,
            shopDrawingDownloadUrl: 1,
            shopDrawingFileName: 1,
          },
        },
      )
    }

    async function refreshMondayOrders() {
      const snapshot = await fetchMondayDashboardSnapshot()
      await persistNewMondayOrders(snapshot)
      await setDashboardSnapshotCache('monday', snapshot)
    }

    const refreshRequested = isDashboardRefreshRequested(req)
    let orderDocument = await loadOrderDrawingDocument()

    if (
      refreshRequested
      || !orderDocument
      || !String(orderDocument.shopDrawingDownloadUrl ?? '').trim()
    ) {
      await refreshMondayOrders()
      orderDocument = await loadOrderDrawingDocument()
    }

    if (!orderDocument) {
      return res.status(404).json({ error: 'Order not found in Monday data.' })
    }

    const cachedDrawingUrl = String(orderDocument.shopDrawingDownloadUrl ?? '').trim()

    if (!cachedDrawingUrl) {
      return res.status(404).json({ error: 'No cached shop drawing found for this order.' })
    }

    if (renderInline) {
      return res.redirect(302, cachedDrawingUrl)
    }

    let upstreamResponse = await fetch(cachedDrawingUrl)

    if (!upstreamResponse.ok && !refreshRequested) {
      await refreshMondayOrders()
      orderDocument = await loadOrderDrawingDocument()

      const refreshedDrawingUrl = String(orderDocument?.shopDrawingDownloadUrl ?? '').trim()

      if (refreshedDrawingUrl) {
        upstreamResponse = await fetch(refreshedDrawingUrl)
      }
    }

    if (!upstreamResponse.ok) {
      return res.status(502).json({
        error: 'Could not download this shop drawing from cache right now.',
      })
    }

    const downloadFileName = ensurePdfFileName(
      orderDocument.shopDrawingFileName,
      `order-${orderId}-shop-drawing.pdf`,
    )
    const contentType =
      String(upstreamResponse.headers.get('content-type') ?? '').trim() ||
      'application/pdf'
    const contentLength = String(upstreamResponse.headers.get('content-length') ?? '').trim()

    res.setHeader('Content-Type', contentType)
    const contentDispositionType = renderInline ? 'inline' : 'attachment'
    res.setHeader(
      'Content-Disposition',
      `${contentDispositionType}; filename="${downloadFileName.replace(/"/g, '')}"`,
    )
    res.setHeader('Cache-Control', 'private, max-age=120')
    if (contentLength) {
      res.setHeader('Content-Length', contentLength)
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer())

    return res.status(200).send(buffer)
  } catch (error) {
    next(error)
  }
})

app.get('/api/dashboard/zendesk', async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache('zendesk')

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskTicketSummary()
    await setDashboardSnapshotCache('zendesk', snapshot)

    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/alerts', async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    const snapshotKey = 'support_alerts'

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache(snapshotKey)

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskSupportAlerts()
    await setDashboardSnapshotCache(snapshotKey, snapshot)
    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/alerts/tickets', async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    const limitPerBucket = toBoundedInteger(req.query?.limitPerBucket, 10, 200, 100)
    const snapshotKey = `support_alert_tickets_${limitPerBucket}`

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache(snapshotKey)

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskSupportAlertTicketsSnapshot(limitPerBucket)
    await setDashboardSnapshotCache(snapshotKey, snapshot)
    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/tickets', async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    const limit = toBoundedInteger(req.query?.limit, 10, 100, 50)
    const snapshotKey = `support_tickets_${limit}`

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache(snapshotKey)

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskSupportTicketsSnapshot(limit)
    await setDashboardSnapshotCache(snapshotKey, snapshot)
    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/tickets/:ticketId/conversation', async (req, res, next) => {
  try {
    const ticketId = String(req.params.ticketId ?? '').trim()

    if (!/^[0-9]+$/.test(ticketId)) {
      return res.status(400).json({ error: 'ticketId must be numeric.' })
    }

    const conversation = await fetchZendeskTicketConversation(ticketId)
    res.json(conversation)
  } catch (error) {
    next(error)
  }
})

app.post('/api/support/tickets', async (req, res, next) => {
  try {
    const subject = String(req.body?.subject ?? '').trim()
    const description = String(req.body?.description ?? '').trim()
    const requesterName = String(req.body?.requesterName ?? '').trim()
    const requesterEmail = String(req.body?.requesterEmail ?? '').trim()
    const priority = String(req.body?.priority ?? '').trim().toLowerCase()

    if (!subject) {
      return res.status(400).json({ error: 'subject is required.' })
    }

    if (!description) {
      return res.status(400).json({ error: 'description is required.' })
    }

    if (requesterEmail && !requesterName) {
      return res.status(400).json({ error: 'requesterName is required when requesterEmail is provided.' })
    }

    const allowedPriorities = ['low', 'normal', 'high', 'urgent']
    const normalizedPriority = allowedPriorities.includes(priority) ? priority : null

    const createdTicket = await createZendeskSupportTicket({
      subject,
      description,
      requesterName,
      requesterEmail,
      priority: normalizedPriority,
    })

    try {
      await clearSupportSnapshotCache()
    } catch (cacheError) {
      console.warn('Unable to clear support snapshot cache after ticket creation.', cacheError)
    }

    return res.status(201).json(createdTicket)
  } catch (error) {
    next(error)
  }
})

}
