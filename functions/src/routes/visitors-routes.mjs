import { NO_ID, nowIso } from '../utils/value-utils.mjs'

const allowedVisitTypes = new Set([
  'delivery',
  'vendor',
  'service',
  'inspection',
  'other',
])

const visitorEntryMaxDurationMinutes = 60
const visitorSavedLimitDefault = 120
const visitorSavedLimitMax = 400
const visitorRecentWindowMinutesDefault = 60
const visitorRecentWindowMinutesMax = 60
const visitorRecentLimitDefault = 120
const visitorRecentLimitMax = 400
const adminVisitorsUsersLimitDefault = 80
const adminVisitorsUsersLimitMax = 400
const adminVisitorsEntriesPerUserDefault = 60
const adminVisitorsEntriesPerUserMax = 300

function normalizeShortText(value, maxLength = 240) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function normalizeVisitType(value) {
  const normalized = normalizeShortText(value, 60).toLowerCase()

  return allowedVisitTypes.has(normalized) ? normalized : 'other'
}

function normalizeOtherVisitType(visitType, value) {
  if (visitType !== 'other') {
    return null
  }

  return normalizeShortText(value, 180) || null
}

function normalizeShortcutKey({
  name,
  company,
  visitType,
  otherVisitType,
}) {
  return [
    normalizeShortText(name, 240).toLowerCase(),
    normalizeShortText(company, 240).toLowerCase(),
    normalizeVisitType(visitType),
    normalizeShortText(otherVisitType, 240).toLowerCase(),
  ].join('::')
}

function toPublicVisitorEntry(document) {
  return {
    id: normalizeShortText(document?.id, 120),
    name: normalizeShortText(document?.name, 180),
    company: normalizeShortText(document?.company, 220),
    visitType: normalizeVisitType(document?.visitType),
    otherVisitType: normalizeOtherVisitType(
      normalizeVisitType(document?.visitType),
      document?.otherVisitType,
    ),
    durationMinutes: Math.max(1, Number(document?.durationMinutes) || 1),
    createdAt: normalizeShortText(document?.createdAt, 80) || null,
    expiresAt: normalizeShortText(document?.expiresAt, 80) || null,
    createdBy: {
      uid: normalizeShortText(document?.createdByUid, 160) || null,
      email: normalizeShortText(document?.createdByEmail, 320) || null,
      displayName: normalizeShortText(document?.createdByDisplayName, 180) || null,
    },
  }
}

function toPublicVisitorShortcut(document) {
  return {
    id: normalizeShortText(document?.id, 120),
    name: normalizeShortText(document?.name, 180),
    company: normalizeShortText(document?.company, 220),
    visitType: normalizeVisitType(document?.visitType),
    otherVisitType: normalizeOtherVisitType(
      normalizeVisitType(document?.visitType),
      document?.otherVisitType,
    ),
    createdAt: normalizeShortText(document?.createdAt, 80) || null,
    updatedAt: normalizeShortText(document?.updatedAt, 80) || null,
    updatedBy: {
      uid: normalizeShortText(document?.updatedByUid, 160) || null,
      email: normalizeShortText(document?.updatedByEmail, 320) || null,
      displayName: normalizeShortText(document?.updatedByDisplayName, 180) || null,
    },
  }
}

export function registerVisitorsRoutes(app, deps) {
  const {
    getCollections,
    normalizeEmail,
    randomUUID,
    requireAdminRole,
    requireFirebaseAuth,
    toBoundedInteger,
    toPublicAuthUser,
  } = deps

  function resolveApprovedUserOrRespond(req, res) {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved) {
      res.status(403).json({
        error: 'Approved access is required.',
      })
      return null
    }

    return publicUser
  }

app.get('/api/visitors/saved', requireFirebaseAuth, async (req, res, next) => {
  try {
    const publicUser = resolveApprovedUserOrRespond(req, res)

    if (!publicUser) {
      return
    }

    const limit = toBoundedInteger(
      req.query?.limit,
      10,
      visitorSavedLimitMax,
      visitorSavedLimitDefault,
    )
    const { visitorShortcutsCollection } = await getCollections()
    const shortcuts = await visitorShortcutsCollection
      .find(
        {},
        NO_ID,
      )
      .sort({ updatedAt: -1, createdAt: -1, name: 1 })
      .limit(limit)
      .toArray()

    return res.json({
      shortcuts: shortcuts.map((document) => toPublicVisitorShortcut(document)),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/visitors/saved', requireFirebaseAuth, async (req, res, next) => {
  try {
    const publicUser = resolveApprovedUserOrRespond(req, res)

    if (!publicUser) {
      return
    }

    const name = normalizeShortText(req.body?.name, 180)
    const company = normalizeShortText(req.body?.company, 220)
    const visitType = normalizeVisitType(req.body?.visitType)
    const otherVisitType = normalizeOtherVisitType(visitType, req.body?.otherVisitType)

    if (!name) {
      return res.status(400).json({ error: 'Visitor name is required.' })
    }

    if (!company) {
      return res.status(400).json({ error: 'Company is required.' })
    }

    if (visitType === 'other' && !otherVisitType) {
      return res.status(400).json({ error: 'Other visitor type details are required.' })
    }

    const now = nowIso()
    const shortcutKey = normalizeShortcutKey({
      name,
      company,
      visitType,
      otherVisitType,
    })
    const { visitorShortcutsCollection } = await getCollections()
    const shortcutDocument = await visitorShortcutsCollection.findOneAndUpdate(
      {
        shortcutKey,
      },
      {
        $set: {
          name,
          company,
          visitType,
          otherVisitType,
          shortcutKey,
          updatedAt: now,
          updatedByUid: normalizeShortText(publicUser.uid, 160),
          updatedByEmail: normalizeShortText(publicUser.email, 320),
          updatedByDisplayName: normalizeShortText(publicUser.displayName, 180) || null,
        },
        $setOnInsert: {
          id: randomUUID(),
          createdAt: now,
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
        ...NO_ID,
      },
    )

    return res.status(201).json({
      shortcut: toPublicVisitorShortcut(shortcutDocument),
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/visitors/saved/:shortcutId', requireFirebaseAuth, async (req, res, next) => {
  try {
    const publicUser = resolveApprovedUserOrRespond(req, res)

    if (!publicUser) {
      return
    }

    const shortcutId = normalizeShortText(req.params?.shortcutId, 120)

    if (!shortcutId) {
      return res.status(400).json({ error: 'shortcutId is required.' })
    }

    const { visitorShortcutsCollection } = await getCollections()
    const deletedShortcut = await visitorShortcutsCollection.findOneAndDelete(
      {
        id: shortcutId,
      },
      NO_ID,
    )

    if (!deletedShortcut) {
      return res.status(404).json({ error: 'Saved visitor not found.' })
    }

    return res.json({
      ok: true,
      shortcutId,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/visitors/logs', requireFirebaseAuth, async (req, res, next) => {
  try {
    const publicUser = resolveApprovedUserOrRespond(req, res)

    if (!publicUser) {
      return
    }

    const name = normalizeShortText(req.body?.name, 180)
    const company = normalizeShortText(req.body?.company, 220)
    const visitType = normalizeVisitType(req.body?.visitType)
    const otherVisitType = normalizeOtherVisitType(visitType, req.body?.otherVisitType)
    const durationMinutes = toBoundedInteger(
      req.body?.durationMinutes,
      1,
      visitorEntryMaxDurationMinutes,
      5,
    )

    if (!name) {
      return res.status(400).json({ error: 'Visitor name is required.' })
    }

    if (!company) {
      return res.status(400).json({ error: 'Company is required.' })
    }

    if (visitType === 'other' && !otherVisitType) {
      return res.status(400).json({ error: 'Other visitor type details are required.' })
    }

    if (durationMinutes > visitorEntryMaxDurationMinutes) {
      return res.status(400).json({
        error: 'Visit duration cannot be more than 1 hour.',
      })
    }

    const createdAt = nowIso()
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
    const entryDocument = {
      id: randomUUID(),
      name,
      company,
      visitType,
      otherVisitType,
      durationMinutes,
      createdAt,
      expiresAt,
      createdByUid: normalizeShortText(publicUser.uid, 160),
      createdByEmail: normalizeShortText(publicUser.email, 320),
      createdByEmailLower: normalizeEmail(publicUser.email),
      createdByDisplayName: normalizeShortText(publicUser.displayName, 180) || null,
      updatedAt: createdAt,
    }

    const { visitorLogsCollection } = await getCollections()

    await visitorLogsCollection.insertOne(entryDocument)

    return res.status(201).json({
      entry: toPublicVisitorEntry(entryDocument),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/visitors/logs/recent', requireFirebaseAuth, async (req, res, next) => {
  try {
    const publicUser = resolveApprovedUserOrRespond(req, res)

    if (!publicUser) {
      return
    }

    const windowMinutes = toBoundedInteger(
      req.query?.minutes,
      1,
      visitorRecentWindowMinutesMax,
      visitorRecentWindowMinutesDefault,
    )
    const limit = toBoundedInteger(
      req.query?.limit,
      10,
      visitorRecentLimitMax,
      visitorRecentLimitDefault,
    )
    const createdAtCutoffIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString()

    const { visitorLogsCollection } = await getCollections()
    const entries = await visitorLogsCollection
      .find(
        {
          createdAt: {
            $gte: createdAtCutoffIso,
          },
        },
        NO_ID,
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()

    return res.json({
      windowMinutes,
      generatedAt: nowIso(),
      entries: entries.map((document) => toPublicVisitorEntry(document)),
    })
  } catch (error) {
    next(error)
  }
})

app.get(
  '/api/admin/visitors/history',
  requireFirebaseAuth,
  requireAdminRole,
  async (req, res, next) => {
    try {
      const filterUid = normalizeShortText(req.query?.uid, 160)
      const search = normalizeShortText(req.query?.search, 120).toLowerCase()
      const usersLimit = toBoundedInteger(
        req.query?.usersLimit,
        1,
        adminVisitorsUsersLimitMax,
        adminVisitorsUsersLimitDefault,
      )
      const entriesPerUser = toBoundedInteger(
        req.query?.entriesPerUser,
        1,
        adminVisitorsEntriesPerUserMax,
        adminVisitorsEntriesPerUserDefault,
      )
      const now = nowIso()
      const { visitorLogsCollection, authUsersCollection } = await getCollections()

      const summaryMatch = filterUid
        ? {
          createdByUid: filterUid,
        }
        : {}
      const summaryPipeline = [
        ...(filterUid ? [{ $match: summaryMatch }] : []),
        {
          $group: {
            _id: '$createdByUid',
            email: {
              $first: '$createdByEmail',
            },
            displayName: {
              $first: '$createdByDisplayName',
            },
            totalEntries: {
              $sum: 1,
            },
            totalMinutes: {
              $sum: {
                $ifNull: ['$durationMinutes', 0],
              },
            },
            activeEntries: {
              $sum: {
                $cond: [{ $gt: ['$expiresAt', now] }, 1, 0],
              },
            },
            lastVisitAt: {
              $max: '$createdAt',
            },
          },
        },
        {
          $sort: {
            lastVisitAt: -1,
          },
        },
      ]

      const rawSummaries = await visitorLogsCollection.aggregate(summaryPipeline).toArray()
      const summaryUids = rawSummaries
        .map((summary) => normalizeShortText(summary?._id, 160))
        .filter(Boolean)

      const authUsers = summaryUids.length > 0
        ? await authUsersCollection
          .find(
            {
              uid: {
                $in: summaryUids,
              },
            },
            {
              projection: {
                _id: 0,
                uid: 1,
                email: 1,
                displayName: 1,
                role: 1,
                isOwner: 1,
                approvalStatus: 1,
              },
            },
          )
          .toArray()
        : []

      const authUserByUid = new Map(
        authUsers.map((user) => [
          normalizeShortText(user?.uid, 160),
          user,
        ]),
      )

      const resolvedSummaries = rawSummaries
        .map((summary) => {
          const uid = normalizeShortText(summary?._id, 160)

          if (!uid) {
            return null
          }

          const authUser = authUserByUid.get(uid)
          const displayName =
            normalizeShortText(authUser?.displayName, 180)
            || normalizeShortText(summary?.displayName, 180)
            || null
          const email =
            normalizeShortText(authUser?.email, 320)
            || normalizeShortText(summary?.email, 320)
            || null

          return {
            uid,
            displayName,
            email,
            role: normalizeShortText(authUser?.role, 60) || null,
            isOwner: Boolean(authUser?.isOwner),
            approvalStatus: normalizeShortText(authUser?.approvalStatus, 60) || null,
            totalEntries: Math.max(0, Number(summary?.totalEntries) || 0),
            totalMinutes: Math.max(0, Number(summary?.totalMinutes) || 0),
            activeEntries: Math.max(0, Number(summary?.activeEntries) || 0),
            lastVisitAt: normalizeShortText(summary?.lastVisitAt, 80) || null,
          }
        })
        .filter((summary) => summary !== null)

      const filteredSummaries = search
        ? resolvedSummaries.filter((summary) => {
          const searchableText = [
            summary.uid,
            summary.displayName,
            summary.email,
            summary.role,
          ]
            .map((value) => String(value ?? '').toLowerCase())
            .join(' ')

          return searchableText.includes(search)
        })
        : resolvedSummaries

      const limitedSummaries = filteredSummaries.slice(0, usersLimit)
      const selectedUids = limitedSummaries
        .map((summary) => summary.uid)
        .filter(Boolean)

      const entriesByUid = new Map()

      if (selectedUids.length > 0) {
        const groupedEntries = await visitorLogsCollection.aggregate([
          {
            $match: {
              createdByUid: {
                $in: selectedUids,
              },
            },
          },
          {
            $sort: {
              createdAt: -1,
            },
          },
          {
            $group: {
              _id: '$createdByUid',
              entries: {
                $push: {
                  id: '$id',
                  name: '$name',
                  company: '$company',
                  visitType: '$visitType',
                  otherVisitType: '$otherVisitType',
                  durationMinutes: '$durationMinutes',
                  createdAt: '$createdAt',
                  expiresAt: '$expiresAt',
                  createdByUid: '$createdByUid',
                  createdByEmail: '$createdByEmail',
                  createdByDisplayName: '$createdByDisplayName',
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              uid: '$_id',
              entries: {
                $slice: ['$entries', entriesPerUser],
              },
            },
          },
        ]).toArray()

        for (const row of groupedEntries) {
          entriesByUid.set(
            normalizeShortText(row?.uid, 160),
            Array.isArray(row?.entries)
              ? row.entries.map((entry) => toPublicVisitorEntry(entry))
              : [],
          )
        }
      }

      const users = limitedSummaries.map((summary) => ({
        ...summary,
        totalHours: Number((summary.totalMinutes / 60).toFixed(2)),
        entries: entriesByUid.get(summary.uid) ?? [],
      }))

      return res.json({
        generatedAt: now,
        users,
        meta: {
          totalUsers: filteredSummaries.length,
          usersLimit,
          entriesPerUser,
        },
      })
    } catch (error) {
      next(error)
    }
  },
)
}
