export function registerAlertsRoutes(app, deps) {
  const {
    authApprovalApproved,
    authClientPlatformApp,
    defaultMobileAndroidLatestBuild,
    defaultMobileAndroidUpdateUrl,
    defaultMobileIosLatestBuild,
    defaultMobileIosUpdateUrl,
    defaultMobileLatestVersion,
    getCollections,
    isPushTokenUnregisteredError,
    mobileAlertTargetModeAll,
    mobileAlertTargetModeSelected,
    mobilePushTokenProviderExpo,
    mobilePushTokenProviderFcm,
    normalizeAnyPushToken,
    normalizeAuthClientPlatform,
    normalizeEmail,
    normalizeMobileAlertTargetMode,
    normalizeOptionalBuildNumber,
    normalizeOptionalShortText,
    randomUUID,
    redactPushTokenForLog,
    requireAdminRole,
    requireFirebaseAuth,
    sendExpoPushMessages,
    sendFcmPushMessages,
    toBoundedInteger,
    toNonNegativeInteger,
    toPublicAuthUser,
    toPublicMobileAlert,
  } = deps


app.get('/api/app-updates/status', async (_req, res, next) => {
  try {
    const configuredAndroidUrl = normalizeOptionalShortText(process.env.MOBILE_ANDROID_UPDATE_URL, 600)
    const configuredIosUrl = normalizeOptionalShortText(process.env.MOBILE_IOS_UPDATE_URL, 600)
    const configuredAndroidVersion = normalizeOptionalShortText(process.env.MOBILE_ANDROID_LATEST_VERSION, 40)
    const configuredIosVersion = normalizeOptionalShortText(process.env.MOBILE_IOS_LATEST_VERSION, 40)
    const configuredAndroidBuild = normalizeOptionalBuildNumber(process.env.MOBILE_ANDROID_LATEST_BUILD)
    const configuredIosBuild = normalizeOptionalBuildNumber(process.env.MOBILE_IOS_LATEST_BUILD)
    const requestedPlatform = String(_req.query?.platform ?? '').trim().toLowerCase() === 'ios'
      ? 'ios'
      : 'android'
    const androidUpdate = {
      url: configuredAndroidUrl ?? defaultMobileAndroidUpdateUrl,
      buildNumber: configuredAndroidBuild ?? defaultMobileAndroidLatestBuild,
      version: configuredAndroidVersion ?? defaultMobileLatestVersion,
    }
    const iosUpdate = {
      url: configuredIosUrl ?? defaultMobileIosUpdateUrl,
      buildNumber: configuredIosBuild ?? defaultMobileIosLatestBuild,
      version: configuredIosVersion ?? defaultMobileLatestVersion,
    }
    const selectedUpdate = requestedPlatform === 'ios' ? iosUpdate : androidUpdate

    return res.json({
      generatedAt: new Date().toISOString(),
      platform: requestedPlatform,
      url: selectedUpdate.url,
      build: selectedUpdate.buildNumber,
      version: selectedUpdate.version,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/alerts/device-token', requireFirebaseAuth, async (req, res, next) => {
  try {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved) {
      return res.status(403).json({
        error: 'Approved access is required.',
      })
    }

    const normalizedPushToken = normalizeAnyPushToken(req.body?.token, req.body?.tokenProvider)

    if (!normalizedPushToken) {
      return res.status(400).json({ error: 'A valid push token is required.' })
    }

    const { token, tokenProvider } = normalizedPushToken

    const now = new Date().toISOString()
    const deviceName = normalizeOptionalShortText(req.body?.deviceName, 120)
    const appVersion = normalizeOptionalShortText(req.body?.appVersion, 40)
    const appBuild = normalizeOptionalShortText(req.body?.appBuild, 40)
    const platform = normalizeAuthClientPlatform(req.body?.platform) ?? authClientPlatformApp
    const { mobilePushTokensCollection } = await getCollections()

    await mobilePushTokensCollection.updateOne(
      {
        token,
      },
      {
        $set: {
          token,
          tokenProvider,
          uid: publicUser.uid,
          emailLower: normalizeEmail(publicUser.email),
          platform,
          deviceName,
          appVersion,
          appBuild,
          active: true,
          disabledReason: null,
          lastSeenAt: now,
          updatedAt: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          createdAt: now,
        },
      },
      {
        upsert: true,
      },
    )

    return res.status(201).json({ ok: true, token, tokenProvider })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/alerts/device-token', requireFirebaseAuth, async (req, res, next) => {
  try {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.uid) {
      return res.status(401).json({ error: 'Authenticated user is required.' })
    }

    const normalizedPushToken = normalizeAnyPushToken(req.body?.token, req.body?.tokenProvider)
    const token = normalizedPushToken?.token ?? null
    const now = new Date().toISOString()
    const { mobilePushTokensCollection } = await getCollections()

    if (token) {
      await mobilePushTokensCollection.updateOne(
        {
          token,
          uid: publicUser.uid,
        },
        {
          $set: {
            active: false,
            disabledReason: 'user_signout',
            updatedAt: now,
          },
        },
      )

      return res.json({ ok: true, token })
    }

    await mobilePushTokensCollection.updateMany(
      {
        uid: publicUser.uid,
      },
      {
        $set: {
          active: false,
          disabledReason: 'user_signout',
          updatedAt: now,
        },
      },
    )

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/alerts/my', requireFirebaseAuth, async (req, res, next) => {
  try {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved) {
      return res.status(403).json({
        error: 'Approved access is required.',
      })
    }

    const limit = toBoundedInteger(req.query?.limit, 10, 200, 60)
    const { mobileAlertsCollection, mobileAlertReadsCollection } = await getCollections()
    const alerts = await mobileAlertsCollection
      .find(
        {
          $or: [
            { targetMode: mobileAlertTargetModeAll },
            { targetUserUids: publicUser.uid },
          ],
        },
        {
          projection: {
            _id: 0,
          },
        },
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()

    const alertIds = alerts
      .map((document) => String(document?.id ?? '').trim())
      .filter(Boolean)
    const readDocuments = alertIds.length > 0
      ? await mobileAlertReadsCollection
        .find(
          {
            uid: publicUser.uid,
            alertId: {
              $in: alertIds,
            },
          },
          {
            projection: {
              _id: 0,
              alertId: 1,
              readAt: 1,
            },
          },
        )
        .toArray()
      : []
    const readStateByAlertId = new Map(
      readDocuments.map((document) => [
        String(document?.alertId ?? '').trim(),
        String(document?.readAt ?? '').trim() || null,
      ]),
    )
    const alertsWithReadState = alerts.map((document) => {
      const publicAlert = toPublicMobileAlert(document)
      const readAt = readStateByAlertId.get(publicAlert.id) ?? null

      return {
        ...publicAlert,
        isRead: Boolean(readAt),
        readAt,
      }
    })
    const unreadCount = alertsWithReadState.reduce(
      (total, alert) => total + (alert.isRead ? 0 : 1),
      0,
    )

    return res.json({
      alerts: alertsWithReadState,
      unreadCount,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/alerts/:alertId/read', requireFirebaseAuth, async (req, res, next) => {
  try {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved) {
      return res.status(403).json({
        error: 'Approved access is required.',
      })
    }

    const alertId = String(req.params.alertId ?? '').trim()

    if (!alertId) {
      return res.status(400).json({
        error: 'alertId is required.',
      })
    }

    const { mobileAlertsCollection, mobileAlertReadsCollection } = await getCollections()
    const alertDocument = await mobileAlertsCollection.findOne(
      {
        id: alertId,
        $or: [
          {
            targetMode: mobileAlertTargetModeAll,
          },
          {
            targetUserUids: publicUser.uid,
          },
        ],
      },
      {
        projection: {
          _id: 0,
          id: 1,
        },
      },
    )

    if (!alertDocument?.id) {
      return res.status(404).json({
        error: 'Alert not found.',
      })
    }

    const now = new Date().toISOString()
    const readDocument = await mobileAlertReadsCollection.findOneAndUpdate(
      {
        uid: publicUser.uid,
        alertId,
      },
      {
        $set: {
          uid: publicUser.uid,
          alertId,
          updatedAt: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          createdAt: now,
          readAt: now,
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
        projection: {
          _id: 0,
          readAt: 1,
        },
      },
    )

    return res.json({
      ok: true,
      alertId,
      isRead: true,
      readAt: String(readDocument?.readAt ?? '').trim() || now,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/admin/alerts', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const limit = toBoundedInteger(req.query?.limit, 10, 200, 80)
    const { mobileAlertsCollection } = await getCollections()
    const alerts = await mobileAlertsCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
          },
        },
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()

    return res.json({
      alerts: alerts.map((document) => toPublicMobileAlert(document)),
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/admin/alerts/:alertId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const alertId = String(req.params?.alertId ?? '').trim()

    if (!alertId) {
      return res.status(400).json({
        error: 'alertId is required.',
      })
    }

    const { mobileAlertsCollection, mobileAlertReadsCollection } = await getCollections()
    const deleteResult = await mobileAlertsCollection.deleteOne({
      id: alertId,
    })

    if (toNonNegativeInteger(deleteResult.deletedCount) < 1) {
      return res.status(404).json({
        error: 'Alert not found.',
      })
    }

    const deleteReadsResult = await mobileAlertReadsCollection.deleteMany({
      alertId,
    })

    return res.json({
      ok: true,
      alertId,
      deletedReadCount: toNonNegativeInteger(deleteReadsResult.deletedCount),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/alerts/send', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const title = normalizeOptionalShortText(req.body?.title, 120)
    const requestedMessage = normalizeOptionalShortText(req.body?.message, 600)
    const targetMode = normalizeMobileAlertTargetMode(req.body?.targetMode)
    const isUpdate = req.body?.isUpdate === true
    const message = requestedMessage
      ?? (isUpdate ? 'A new app update is available. Open Settings -> App Updates.' : null)

    if (!title) {
      return res.status(400).json({ error: 'title is required.' })
    }

    if (!message) {
      return res.status(400).json({ error: 'message is required.' })
    }

    if (!targetMode) {
      return res.status(400).json({
        error: "targetMode must be 'all' or 'selected'.",
      })
    }

    const requestedUserUids = Array.from(
      new Set(
        (Array.isArray(req.body?.userUids) ? req.body.userUids : [])
          .map((value) => String(value ?? '').trim())
          .filter(Boolean),
      ),
    )

    if (targetMode === mobileAlertTargetModeSelected && requestedUserUids.length === 0) {
      return res.status(400).json({
        error: 'Select at least one user.',
      })
    }

    const { authUsersCollection, mobilePushTokensCollection, mobileAlertsCollection } = await getCollections()

    const candidateUsers = targetMode === mobileAlertTargetModeAll
      ? await authUsersCollection
        .find(
          {
            approvalStatus: authApprovalApproved,
          },
          {
            projection: {
              _id: 0,
            },
          },
        )
        .toArray()
      : await authUsersCollection
        .find(
          {
            uid: {
              $in: requestedUserUids,
            },
          },
          {
            projection: {
              _id: 0,
            },
          },
        )
        .toArray()

    const recipientUsers = candidateUsers
      .map((document) => toPublicAuthUser(document))
      .filter((user) => {
        if (!user?.uid || !user.isApproved) {
          return false
        }

        return targetMode === mobileAlertTargetModeAll ? user.hasAppAccess : true
      })

    if (recipientUsers.length === 0) {
      return res.status(400).json({
        error:
          targetMode === mobileAlertTargetModeAll
            ? 'No approved app users are available.'
            : 'No valid approved users matched your selection.',
      })
    }

    const recipientUids = recipientUsers.map((user) => user.uid)
    const tokenFilter = {
      uid: {
        $in: recipientUids,
      },
      active: {
        $ne: false,
      },
    }
    const rawTokenDocuments = await mobilePushTokensCollection
      .find(
        tokenFilter,
        {
          projection: {
            _id: 0,
            token: 1,
            tokenProvider: 1,
          },
        },
      )
      .toArray()

    const expoTokens = []
    const fcmTokens = []

    rawTokenDocuments.forEach((document) => {
      const normalizedPushToken = normalizeAnyPushToken(document?.token, document?.tokenProvider)

      if (!normalizedPushToken) {
        return
      }

      if (normalizedPushToken.tokenProvider === mobilePushTokenProviderExpo) {
        expoTokens.push(normalizedPushToken.token)
        return
      }

      if (normalizedPushToken.tokenProvider === mobilePushTokenProviderFcm) {
        fcmTokens.push(normalizedPushToken.token)
      }
    })

    const uniqueExpoTokens = Array.from(new Set(expoTokens))
    const uniqueFcmTokens = Array.from(new Set(fcmTokens))
    const uniqueTokens = [...uniqueExpoTokens, ...uniqueFcmTokens]

    const alertId = randomUUID()
    const pushData = {
      alertId,
      type: isUpdate ? 'app_update' : 'admin_alert',
      route: isUpdate ? 'settings' : 'alerts',
      screen: isUpdate ? 'settings' : 'alerts',
    }
    const expoPushPayloads = uniqueExpoTokens.map((token) => ({
      to: token,
      sound: 'default',
      title,
      body: message,
      data: pushData,
      priority: 'high',
      channelId: 'alerts',
    }))
    const [expoDeliveryResult, fcmDeliveryResult] = await Promise.all([
      sendExpoPushMessages(expoPushPayloads),
      sendFcmPushMessages({
        tokens: uniqueFcmTokens,
        title,
        body: message,
        data: pushData,
      }),
    ])
    const deliveryResult = {
      acceptedCount: expoDeliveryResult.acceptedCount + fcmDeliveryResult.acceptedCount,
      errorEntries: [...expoDeliveryResult.errorEntries, ...fcmDeliveryResult.errorEntries],
    }
    const deliveryErrorSamples = deliveryResult.errorEntries.slice(0, 5).map((entry) => {
      const normalizedPushToken = normalizeAnyPushToken(entry.token)

      return {
        tokenProvider: normalizedPushToken?.tokenProvider ?? null,
        token: redactPushTokenForLog(entry.token),
        error: String(entry.error ?? '').trim() || 'Push delivery failed.',
      }
    })

    if (deliveryResult.errorEntries.length > 0) {
      console.error(
        'Mobile push delivery errors',
        JSON.stringify({
          alertId,
          errorCount: deliveryResult.errorEntries.length,
          samples: deliveryErrorSamples,
        }),
      )
    }

    const invalidTokens = Array.from(
      new Set(
        deliveryResult.errorEntries
          .filter((entry) => isPushTokenUnregisteredError(entry.error))
          .map((entry) => normalizeAnyPushToken(entry.token)?.token)
          .filter(Boolean),
      ),
    )
    const now = new Date().toISOString()

    if (invalidTokens.length > 0) {
      await mobilePushTokensCollection.deleteMany(
        {
          token: {
            $in: invalidTokens,
          },
        },
      )
    }

    const createdByEmail = normalizeEmail(req.authUser?.emailLower)
      ? String(req.authUser.emailLower)
      : null
    const alertDocument = {
      id: alertId,
      title,
      message,
      isUpdate,
      targetMode,
      targetUserUids: targetMode === mobileAlertTargetModeAll ? [] : recipientUids,
      createdByUid: String(req.authUser?.uid ?? '').trim() || null,
      createdByEmail,
      delivery: {
        targetUserCount: recipientUids.length,
        pushTokenCount: uniqueTokens.length,
        pushAcceptedCount: deliveryResult.acceptedCount,
        pushErrorCount: deliveryResult.errorEntries.length,
        errorSamples: deliveryErrorSamples,
      },
      createdAt: now,
      updatedAt: now,
    }

    await mobileAlertsCollection.insertOne(alertDocument)

    return res.status(201).json({
      ok: true,
      alert: toPublicMobileAlert(alertDocument),
      summary: {
        targetUsers: recipientUids.length,
        pushTokens: uniqueTokens.length,
        accepted: deliveryResult.acceptedCount,
        failed: deliveryResult.errorEntries.length,
      },
    })
  } catch (error) {
    next(error)
  }
})

}
