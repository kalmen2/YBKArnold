export function registerAuthRoutes(app, deps) {
  const {
    authAccessTimeZoneNewJersey,
    authActivityTypeApiRequest,
    authActivityTypeUiEvent,
    authApprovalApproved,
    authApprovalPending,
    authClientAccessModeWebAndApp,
    authRoleAdmin,
    authRoleStandard,
    ensureWorkersHaveWorkerNumbers,
    extractRequestIpAddress,
    extractRequestUserAgent,
    getCollections,
    invalidateAuthUserCache,
    normalizeAuthAccessTimeZone,
    normalizeAuthClientAccessMode,
    normalizeAuthRole,
    normalizeEmail,
    normalizeWorkerNumber,
    ownerEmail,
    parseOptionalAuthAccessTimeZone,
    parseOptionalAuthHour,
    requireAdminRole,
    requireFirebaseAuth,
    toBoundedInteger,
    toPublicAuthUser,
    writeAuthActivityLog,
  } = deps


app.get('/api/health', async (_req, res, next) => {
  try {
    const { database } = await getCollections()
    await database.command({ ping: 1 })
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/me', requireFirebaseAuth, async (req, res, next) => {
  try {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser) {
      throw {
        status: 500,
        message: 'Unable to load authenticated user.',
      }
    }

    if (!publicUser.isApproved) {
      return res.status(403).json({
        error: 'Your account is waiting for admin approval.',
        user: publicUser,
        ownerEmail,
      })
    }

    return res.json({
      user: publicUser,
      ownerEmail,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/users', requireFirebaseAuth, requireAdminRole, async (_req, res, next) => {
  try {
    const { authUsersCollection } = await getCollections()
    const users = await authUsersCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
          },
        },
      )
      .sort({
        approvalStatus: -1,
        createdAt: -1,
        emailLower: 1,
      })
      .toArray()

    return res.json({
      users: users.map((document) => toPublicAuthUser(document)),
      ownerEmail,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/workers', requireFirebaseAuth, requireAdminRole, async (_req, res, next) => {
  try {
    const { workersCollection } = await getCollections()
    const workers = await workersCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
          },
        },
      )
      .sort({ fullName: 1 })
      .toArray()
    const workersWithNumbers = await ensureWorkersHaveWorkerNumbers(workersCollection, workers)

    return res.json({
      workers: workersWithNumbers.map((worker) => ({
        id: String(worker.id ?? '').trim(),
        workerNumber: normalizeWorkerNumber(worker.workerNumber),
        fullName: String(worker.fullName ?? '').trim(),
        role: String(worker.role ?? '').trim(),
        email: String(worker.email ?? '').trim(),
      })),
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/auth/users/:uid/worker-link', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const targetUid = String(req.params.uid ?? '').trim()

    if (!targetUid) {
      return res.status(400).json({ error: 'uid is required.' })
    }

    const rawWorkerId = String(req.body?.workerId ?? '').trim()
    const workerId = rawWorkerId || null
    const { authUsersCollection, workersCollection } = await getCollections()
    const existingUser = await authUsersCollection.findOne(
      { uid: targetUid },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found.' })
    }

    let linkedWorker = null

    if (workerId) {
      const matchedWorker = await workersCollection.findOne(
        { id: workerId },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!matchedWorker) {
        return res.status(400).json({ error: 'Selected worker was not found.' })
      }

      const [workerWithNumber] = await ensureWorkersHaveWorkerNumbers(workersCollection, [matchedWorker])
      linkedWorker = workerWithNumber

      const existingLinkedUser = await authUsersCollection.findOne(
        {
          linkedWorkerId: workerId,
          uid: {
            $ne: targetUid,
          },
        },
        {
          projection: {
            _id: 0,
            uid: 1,
            email: 1,
          },
        },
      )

      if (existingLinkedUser) {
        return res.status(400).json({
          error: `Worker is already linked to ${String(existingLinkedUser.email ?? '').trim() || 'another user'}.`,
        })
      }
    }

    const now = new Date().toISOString()
    const updatedUser = await authUsersCollection.findOneAndUpdate(
      { uid: targetUid },
      {
        $set: {
          linkedWorkerId: linkedWorker ? String(linkedWorker.id ?? '').trim() : null,
          linkedWorkerNumber: linkedWorker ? normalizeWorkerNumber(linkedWorker.workerNumber) : null,
          linkedWorkerName: linkedWorker ? String(linkedWorker.fullName ?? '').trim() || null : null,
          updatedAt: now,
        },
      },
      {
        returnDocument: 'after',
        projection: {
          _id: 0,
        },
      },
    )

    return res.json({
      user: toPublicAuthUser(updatedUser),
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/auth/users/:uid/approval', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const targetUid = String(req.params.uid ?? '').trim()

    if (!targetUid) {
      return res.status(400).json({ error: 'uid is required.' })
    }

    const role = normalizeAuthRole(req.body?.role)

    if (!role) {
      return res.status(400).json({
        error: "role must be 'standard', 'manager', or 'admin'.",
      })
    }

    const { authUsersCollection } = await getCollections()
    const existingUser = await authUsersCollection.findOne(
      { uid: targetUid },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found.' })
    }

    const targetEmailLower = normalizeEmail(existingUser.emailLower)
    const isOwnerTarget = targetEmailLower === ownerEmail
    const existingPublicUser = toPublicAuthUser(existingUser)
    const requiresAdminPromotionConfirmation =
      !isOwnerTarget
      && role === authRoleAdmin
      && !existingPublicUser?.isAdmin
    const confirmAdminPromotion =
      req.body?.confirmAdminPromotion === true
      || String(req.body?.confirmAdminPromotion ?? '').trim().toLowerCase() === 'true'

    if (requiresAdminPromotionConfirmation && !confirmAdminPromotion) {
      return res.status(400).json({
        error: 'Admin promotion requires explicit confirmation.',
      })
    }

    const approvedRole = isOwnerTarget ? authRoleAdmin : role
    const approvedByEmail = normalizeEmail(req.authUser?.emailLower)
      ? String(req.authUser.emailLower)
      : ownerEmail
    const now = new Date().toISOString()

    const updatedUser = await authUsersCollection.findOneAndUpdate(
      { uid: targetUid },
      {
        $set: {
          role: approvedRole,
          approvalStatus: authApprovalApproved,
          approvedAt: now,
          approvedByUid: String(req.authUser?.uid ?? '').trim() || null,
          approvedByEmail,
          updatedAt: now,
        },
      },
      {
        returnDocument: 'after',
        projection: {
          _id: 0,
        },
      },
    )

    invalidateAuthUserCache(targetUid)

    return res.json({
      user: toPublicAuthUser(updatedUser),
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/auth/users/:uid/client-access', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const targetUid = String(req.params.uid ?? '').trim()

    if (!targetUid) {
      return res.status(400).json({ error: 'uid is required.' })
    }

    const requestedAccessMode = normalizeAuthClientAccessMode(req.body?.mode)

    if (!requestedAccessMode) {
      return res.status(400).json({
        error: "mode must be 'web_and_app', 'web_only', or 'app_only'.",
      })
    }

    const { authUsersCollection } = await getCollections()
    const existingUser = await authUsersCollection.findOne(
      { uid: targetUid },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found.' })
    }

    const existingPublicUser = toPublicAuthUser(existingUser)

    if (existingPublicUser?.isOwner && requestedAccessMode !== authClientAccessModeWebAndApp) {
      return res.status(400).json({ error: 'Owner account must keep website access enabled.' })
    }

    const now = new Date().toISOString()
    const nextAccessMode = existingPublicUser?.isOwner
      ? authClientAccessModeWebAndApp
      : requestedAccessMode

    const updatedUser = await authUsersCollection.findOneAndUpdate(
      { uid: targetUid },
      {
        $set: {
          clientAccessMode: nextAccessMode,
          updatedAt: now,
        },
      },
      {
        returnDocument: 'after',
        projection: {
          _id: 0,
        },
      },
    )

    invalidateAuthUserCache(targetUid)

    return res.json({
      user: toPublicAuthUser(updatedUser),
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/auth/users/:uid/unapprove', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const targetUid = String(req.params.uid ?? '').trim()

    if (!targetUid) {
      return res.status(400).json({ error: 'uid is required.' })
    }

    const { authUsersCollection } = await getCollections()
    const existingUser = await authUsersCollection.findOne(
      { uid: targetUid },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found.' })
    }

    const existingPublicUser = toPublicAuthUser(existingUser)

    if (existingPublicUser?.isOwner) {
      return res.status(400).json({ error: 'Owner account cannot be unapproved.' })
    }

    const now = new Date().toISOString()
    const updatedUser = await authUsersCollection.findOneAndUpdate(
      { uid: targetUid },
      {
        $set: {
          role: authRoleStandard,
          approvalStatus: authApprovalPending,
          approvedAt: null,
          approvedByUid: null,
          approvedByEmail: null,
          updatedAt: now,
        },
      },
      {
        returnDocument: 'after',
        projection: {
          _id: 0,
        },
      },
    )

    invalidateAuthUserCache(targetUid)

    return res.json({
      user: toPublicAuthUser(updatedUser),
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/auth/users/:uid', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const targetUid = String(req.params.uid ?? '').trim()

    if (!targetUid) {
      return res.status(400).json({ error: 'uid is required.' })
    }

    if (targetUid === String(req.authUser?.uid ?? '').trim()) {
      return res.status(400).json({ error: 'You cannot delete your own account.' })
    }

    const { authUsersCollection, authActivityLogsCollection } = await getCollections()
    const existingUser = await authUsersCollection.findOne(
      { uid: targetUid },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found.' })
    }

    const existingPublicUser = toPublicAuthUser(existingUser)

    if (existingPublicUser?.isOwner) {
      return res.status(400).json({ error: 'Owner account cannot be deleted.' })
    }

    await Promise.all([
      authUsersCollection.deleteOne({ uid: targetUid }),
      authActivityLogsCollection.deleteMany({ uid: targetUid }),
    ])

    invalidateAuthUserCache(targetUid)

    return res.json({
      ok: true,
      uid: targetUid,
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/auth/users/:uid/access-hours', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const targetUid = String(req.params.uid ?? '').trim()

    if (!targetUid) {
      return res.status(400).json({ error: 'uid is required.' })
    }

    const startHourUtc = parseOptionalAuthHour(req.body?.startHourUtc, 'startHourUtc')
    const endHourUtc = parseOptionalAuthHour(req.body?.endHourUtc, 'endHourUtc')
    const requestedTimeZone = parseOptionalAuthAccessTimeZone(req.body?.timeZone)

    if ((startHourUtc === null) !== (endHourUtc === null)) {
      return res.status(400).json({
        error: 'startHourUtc and endHourUtc must both be provided, or both omitted to clear restrictions.',
      })
    }

    if (startHourUtc !== null && endHourUtc !== null && startHourUtc === endHourUtc) {
      return res.status(400).json({
        error: 'startHourUtc and endHourUtc cannot be the same.',
      })
    }

    const { authUsersCollection } = await getCollections()
    const existingUser = await authUsersCollection.findOne(
      { uid: targetUid },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found.' })
    }

    const existingPublicUser = toPublicAuthUser(existingUser)

    if (existingPublicUser?.isAdmin) {
      return res.status(400).json({ error: 'Admin accounts cannot have login-hour restrictions.' })
    }

    const now = new Date().toISOString()
    const nextStartHour = startHourUtc
    const nextEndHour = endHourUtc
    const nextTimeZone =
      requestedTimeZone
      ?? normalizeAuthAccessTimeZone(existingUser.accessTimeZone)
      ?? authAccessTimeZoneNewJersey

    const updatedUser = await authUsersCollection.findOneAndUpdate(
      { uid: targetUid },
      {
        $set: {
          accessStartHourUtc: nextStartHour,
          accessEndHourUtc: nextEndHour,
          accessTimeZone: nextTimeZone,
          updatedAt: now,
        },
      },
      {
        returnDocument: 'after',
        projection: {
          _id: 0,
        },
      },
    )

    return res.json({
      user: toPublicAuthUser(updatedUser),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/activity', requireFirebaseAuth, async (req, res, next) => {
  try {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser) {
      throw {
        status: 500,
        message: 'Unable to resolve activity user.',
      }
    }

    const action = String(req.body?.action ?? '').trim().slice(0, 120)

    if (!action) {
      return res.status(400).json({ error: 'action is required.' })
    }

    const target = String(req.body?.target ?? '').trim().slice(0, 180) || null
    const path = String(req.body?.path ?? '').trim().slice(0, 240) || null

    await writeAuthActivityLog({
      uid: publicUser.uid,
      email: publicUser.email,
      type: authActivityTypeUiEvent,
      action,
      target,
      path,
      method: req.method,
      statusCode: 201,
      ipAddress: extractRequestIpAddress(req),
      userAgent: extractRequestUserAgent(req),
      metadata: req.body?.metadata,
    })

    return res.status(201).json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/logs/users', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const limit = toBoundedInteger(req.query?.limit, 25, 500, 200)
    const { authUsersCollection, authActivityLogsCollection } = await getCollections()
    const users = await authUsersCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
          },
        },
      )
      .toArray()

    const activitySummaryRows = await authActivityLogsCollection
      .aggregate([
        {
          $sort: {
            createdAt: -1,
          },
        },
        {
          $group: {
            _id: '$uid',
            totalEvents: {
              $sum: 1,
            },
            lastActivityAt: {
              $first: '$createdAt',
            },
            lastIpAddress: {
              $first: '$ipAddress',
            },
            lastUserAgent: {
              $first: '$userAgent',
            },
            lastAction: {
              $first: '$action',
            },
          },
        },
      ])
      .toArray()

    const summaryByUid = new Map(
      activitySummaryRows.map((row) => [
        String(row._id ?? '').trim(),
        {
          totalEvents: Number(row.totalEvents ?? 0),
          lastActivityAt: String(row.lastActivityAt ?? '').trim() || null,
          lastIpAddress: String(row.lastIpAddress ?? '').trim() || null,
          lastUserAgent: String(row.lastUserAgent ?? '').trim() || null,
          lastAction: String(row.lastAction ?? '').trim() || null,
        },
      ]),
    )

    const userSummaries = users
      .map((document) => {
        const user = toPublicAuthUser(document)

        if (!user?.uid) {
          return null
        }

        const activitySummary = summaryByUid.get(user.uid) ?? {
          totalEvents: 0,
          lastActivityAt: null,
          lastIpAddress: null,
          lastUserAgent: null,
          lastAction: null,
        }

        return {
          user,
          ...activitySummary,
        }
      })
      .filter(Boolean)

    userSummaries.sort((left, right) => {
      const leftTimestamp = Date.parse(left.lastActivityAt ?? left.user.lastLoginAt ?? '')
      const rightTimestamp = Date.parse(right.lastActivityAt ?? right.user.lastLoginAt ?? '')

      if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)) {
        return rightTimestamp - leftTimestamp
      }

      if (Number.isFinite(rightTimestamp)) {
        return 1
      }

      if (Number.isFinite(leftTimestamp)) {
        return -1
      }

      return left.user.email.localeCompare(right.user.email)
    })

    return res.json({
      users: userSummaries.slice(0, limit),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/logs/users/:uid/info', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const targetUid = String(req.params.uid ?? '').trim()

    if (!targetUid) {
      return res.status(400).json({ error: 'uid is required.' })
    }

    const { authUsersCollection, authActivityLogsCollection } = await getCollections()
    const userDocument = await authUsersCollection.findOne(
      { uid: targetUid },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!userDocument) {
      return res.status(404).json({ error: 'User not found.' })
    }

    const [totalEvents, latestEvent, latestLoginEvent] = await Promise.all([
      authActivityLogsCollection.countDocuments({ uid: targetUid }),
      authActivityLogsCollection.findOne(
        { uid: targetUid },
        {
          sort: {
            createdAt: -1,
          },
          projection: {
            _id: 0,
          },
        },
      ),
      authActivityLogsCollection.findOne(
        {
          uid: targetUid,
          path: '/api/auth/me',
        },
        {
          sort: {
            createdAt: -1,
          },
          projection: {
            _id: 0,
          },
        },
      ),
    ])

    return res.json({
      user: toPublicAuthUser(userDocument),
      summary: {
        totalEvents,
        lastActivityAt: String(latestEvent?.createdAt ?? '').trim() || null,
        lastIpAddress: String(latestEvent?.ipAddress ?? '').trim() || null,
        lastUserAgent: String(latestEvent?.userAgent ?? '').trim() || null,
      },
      latestEvent,
      latestLoginEvent,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/logs/users/:uid/events', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const targetUid = String(req.params.uid ?? '').trim()

    if (!targetUid) {
      return res.status(400).json({ error: 'uid is required.' })
    }

    const eventType = String(req.query?.type ?? '').trim().toLowerCase()
    const limit = toBoundedInteger(req.query?.limit, 20, 1000, 200)
    const filter = {
      uid: targetUid,
    }

    if ([authActivityTypeApiRequest, authActivityTypeUiEvent].includes(eventType)) {
      filter.type = eventType
    }

    const { authActivityLogsCollection } = await getCollections()
    const events = await authActivityLogsCollection
      .find(filter, {
        projection: {
          _id: 0,
        },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()

    return res.json({
      events,
    })
  } catch (error) {
    next(error)
  }
})

}
