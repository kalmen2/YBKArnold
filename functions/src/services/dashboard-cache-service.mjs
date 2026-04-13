export function createDashboardCacheService({ getCollections }) {
  function isDashboardRefreshRequested(req) {
    const rawValue = Array.isArray(req.query?.refresh)
      ? req.query.refresh[0]
      : req.query?.refresh
    const normalizedValue = String(rawValue ?? '')
      .trim()
      .toLowerCase()

    return ['1', 'true', 'yes', 'on'].includes(normalizedValue)
  }

  async function getDashboardSnapshotFromCache(snapshotKey) {
    const { dashboardSnapshotsCollection } = await getCollections()
    const cachedDocument = await dashboardSnapshotsCollection.findOne(
      { snapshotKey },
      {
        projection: {
          _id: 0,
          snapshot: 1,
        },
      },
    )

    return cachedDocument?.snapshot ?? null
  }

  async function setDashboardSnapshotCache(snapshotKey, snapshot) {
    const { dashboardSnapshotsCollection } = await getCollections()

    await dashboardSnapshotsCollection.updateOne(
      { snapshotKey },
      {
        $set: {
          snapshotKey,
          snapshot,
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    )
  }

  async function clearSupportSnapshotCache() {
    const { dashboardSnapshotsCollection } = await getCollections()

    await dashboardSnapshotsCollection.deleteMany({
      snapshotKey: /^support_/,
    })
  }

  return {
    clearSupportSnapshotCache,
    getDashboardSnapshotFromCache,
    isDashboardRefreshRequested,
    setDashboardSnapshotCache,
  }
}
