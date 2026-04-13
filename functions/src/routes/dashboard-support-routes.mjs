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
    getDashboardSnapshotFromCache,
    isDashboardRefreshRequested,
    persistNewMondayOrders,
    setDashboardSnapshotCache,
    toBoundedInteger,
  } = deps


app.get('/api/dashboard/monday', async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache('monday')

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchMondayDashboardSnapshot()

    if (refreshRequested) {
      await persistNewMondayOrders(snapshot)
    }

    await setDashboardSnapshotCache('monday', snapshot)

    res.json(snapshot)
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
