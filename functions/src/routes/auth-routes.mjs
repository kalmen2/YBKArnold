import { nowIso, NO_ID } from '../utils/value-utils.mjs'

export function registerAuthRoutes(app, deps) {
  const {
    authAccessTimeZoneNewJersey,
    authApprovalApproved,
    authApprovalPending,
    authClientAccessModeWebAndApp,
    authRoleAdmin,
    authRoleStandard,
    ensureWorkersHaveWorkerNumbers,
    extractRequestIpAddress,
    extractRequestLocalIpAddress,
    extractRequestUserAgent,
    fetchZendeskSupportAgentById,
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
  } = deps

  async function requireUserByUid(req, res) {
    const targetUid = String(req.params.uid ?? '').trim()
    if (!targetUid) {
      res.status(400).json({ error: 'uid is required.' })
      return null
    }
    const { authUsersCollection } = await getCollections()
    const user = await authUsersCollection.findOne({ uid: targetUid }, NO_ID)
    if (!user) {
      res.status(404).json({ error: 'User not found.' })
      return null
    }
    return user
  }

  async function updateUserAndRespond(res, targetUid, fields) {
    const { authUsersCollection } = await getCollections()
    const updatedUser = await authUsersCollection.findOneAndUpdate(
      { uid: targetUid },
      { $set: { ...fields, updatedAt: nowIso() } },
      { returnDocument: 'after', ...NO_ID },
    )
    invalidateAuthUserCache(targetUid)
    return res.json({ user: toPublicAuthUser(updatedUser) })
  }

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
        error: 'Please contact admin.',
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
        NO_ID,
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
        NO_ID,
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

app.get('/api/auth/bootstrap', requireFirebaseAuth, requireAdminRole, async (_req, res, next) => {
  try {
    const { authUsersCollection, workersCollection } = await getCollections()

    const [users, workers] = await Promise.all([
      authUsersCollection
        .find({}, NO_ID)
        .sort({ approvalStatus: -1, createdAt: -1, emailLower: 1 })
        .toArray(),
      workersCollection
        .find({}, NO_ID)
        .sort({ fullName: 1 })
        .toArray(),
    ])

    const workersWithNumbers = await ensureWorkersHaveWorkerNumbers(workersCollection, workers)

    return res.json({
      users: users.map((document) => toPublicAuthUser(document)),
      ownerEmail,
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
        NO_ID,
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

    const now = nowIso()
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
    invalidateAuthUserCache(targetUid)

    return res.json({
      user: toPublicAuthUser(updatedUser),
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/auth/users/:uid/zendesk-link', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const targetUid = String(req.params.uid ?? '').trim()

    if (!targetUid) {
      return res.status(400).json({ error: 'uid is required.' })
    }

    const rawZendeskUserId = req.body?.zendeskUserId
    const hasRequestedZendeskLink = rawZendeskUserId !== undefined && rawZendeskUserId !== null && String(rawZendeskUserId).trim() !== ''
    const parsedZendeskUserId = hasRequestedZendeskLink
      ? Number(rawZendeskUserId)
      : null

    if (hasRequestedZendeskLink && (!Number.isFinite(parsedZendeskUserId) || parsedZendeskUserId <= 0)) {
      return res.status(400).json({ error: 'zendeskUserId must be numeric when provided.' })
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

    let linkedZendeskUser = null

    if (parsedZendeskUserId) {
      linkedZendeskUser = await fetchZendeskSupportAgentById(parsedZendeskUserId)

      const existingLinkedUser = await authUsersCollection.findOne(
        {
          linkedZendeskUserId: linkedZendeskUser.id,
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
          error: `Zendesk agent is already linked to ${String(existingLinkedUser.email ?? '').trim() || 'another user'}.`,
        })
      }
    }

    const now = nowIso()
    const updatedUser = await authUsersCollection.findOneAndUpdate(
      { uid: targetUid },
      {
        $set: {
          linkedZendeskUserId: linkedZendeskUser?.id ?? null,
          linkedZendeskUserEmail: linkedZendeskUser?.email ?? null,
          linkedZendeskUserName: linkedZendeskUser?.name ?? null,
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

app.patch('/api/auth/users/:uid/approval', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const role = normalizeAuthRole(req.body?.role)

    if (!role) {
      return res.status(400).json({ error: "role must be 'standard', 'manager', or 'admin'." })
    }

    const existingUser = await requireUserByUid(req, res)
    if (!existingUser) return

    const targetUid = String(existingUser.uid)
    const isOwnerTarget = normalizeEmail(existingUser.emailLower) === ownerEmail
    const existingPublicUser = toPublicAuthUser(existingUser)
    const requiresAdminPromotion = !isOwnerTarget && role === authRoleAdmin && !existingPublicUser?.isAdmin
    const confirmAdminPromotion =
      req.body?.confirmAdminPromotion === true
      || String(req.body?.confirmAdminPromotion ?? '').trim().toLowerCase() === 'true'

    if (requiresAdminPromotion && !confirmAdminPromotion) {
      return res.status(400).json({ error: 'Admin promotion requires explicit confirmation.' })
    }

    return updateUserAndRespond(res, targetUid, {
      role: isOwnerTarget ? authRoleAdmin : role,
      approvalStatus: authApprovalApproved,
      approvedAt: nowIso(),
      approvedByUid: String(req.authUser?.uid ?? '').trim() || null,
      approvedByEmail: normalizeEmail(req.authUser?.emailLower) ? String(req.authUser.emailLower) : ownerEmail,
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/auth/users/:uid/client-access', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const requestedAccessMode = normalizeAuthClientAccessMode(req.body?.mode)

    if (!requestedAccessMode) {
      return res.status(400).json({ error: "mode must be 'web_and_app', 'web_only', or 'app_only'." })
    }

    const existingUser = await requireUserByUid(req, res)
    if (!existingUser) return

    const targetUid = String(existingUser.uid)
    const existingPublicUser = toPublicAuthUser(existingUser)

    if (existingPublicUser?.isOwner && requestedAccessMode !== authClientAccessModeWebAndApp) {
      return res.status(400).json({ error: 'Owner account must keep website access enabled.' })
    }

    return updateUserAndRespond(res, targetUid, {
      clientAccessMode: existingPublicUser?.isOwner ? authClientAccessModeWebAndApp : requestedAccessMode,
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/auth/users/:uid/unapprove', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const existingUser = await requireUserByUid(req, res)
    if (!existingUser) return

    if (toPublicAuthUser(existingUser)?.isOwner) {
      return res.status(400).json({ error: 'Owner account cannot be unapproved.' })
    }

    return updateUserAndRespond(res, String(existingUser.uid), {
      role: authRoleStandard,
      approvalStatus: authApprovalPending,
      approvedAt: null,
      approvedByUid: null,
      approvedByEmail: null,
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
      return res.status(400).json({ error: 'Owner account cannot be deleted.' })
    }

    await authUsersCollection.deleteOne({ uid: targetUid })

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

    const now = nowIso()
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
    const targetUid = String(req.authUser?.uid ?? '').trim()

    if (!targetUid) {
      throw {
        status: 500,
        message: 'Unable to resolve authenticated user.',
      }
    }

    const { authUsersCollection } = await getCollections()
    const now = nowIso()

    await authUsersCollection.updateOne(
      { uid: targetUid },
      {
        $set: {
          lastActivityAt: now,
          lastActivityClientPlatform: String(req.authClientPlatform ?? '').trim() || null,
          lastActivityIpAddress: extractRequestIpAddress(req),
          lastActivityLocalIpAddress: extractRequestLocalIpAddress(req),
          lastActivityUserAgent: extractRequestUserAgent(req),
          updatedAt: now,
        },
      },
    )

    return res.status(204).send()
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/logs/users', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const limit = toBoundedInteger(req.query?.limit, 25, 500, 200)
    const signInsLimit = toBoundedInteger(req.query?.signInsLimit, 1, 50, 20)
    const { authUsersCollection } = await getCollections()
    const userDocuments = await authUsersCollection
      .find({}, NO_ID)
      .sort({ lastLoginAt: -1, updatedAt: -1, emailLower: 1 })
      .limit(limit)
      .toArray()

    const users = userDocuments
      .map((document) => {
        const user = toPublicAuthUser(document)

        if (!user?.uid) {
          return null
        }

        const signIns = [...(Array.isArray(user.signInHistory) ? user.signInHistory : [])]
          .sort((left, right) => {
            const leftTs = Date.parse(String(left?.signedInAt ?? ''))
            const rightTs = Date.parse(String(right?.signedInAt ?? ''))

            if (Number.isFinite(leftTs) && Number.isFinite(rightTs)) {
              return rightTs - leftTs
            }

            if (Number.isFinite(rightTs)) {
              return 1
            }

            if (Number.isFinite(leftTs)) {
              return -1
            }

            return 0
          })
          .slice(0, signInsLimit)

        return {
          user,
          lastLoginAt: user.lastLoginAt,
          lastActivityAt: user.lastActivityAt,
          signIns,
        }
      })
      .filter(Boolean)

    return res.json({ users })
  } catch (error) {
    next(error)
  }
})

}
