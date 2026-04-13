import { getMessaging } from 'firebase-admin/messaging'
import { toNonNegativeInteger } from '../utils/value-utils.mjs'

export function createPushAlertService({
  expoPushApiUrl,
  mobileAlertTargetModeAll,
  mobileAlertTargetModeSelected,
  mobilePushTokenProviderExpo,
  mobilePushTokenProviderFcm,
}) {
  function normalizeExpoPushToken(value) {
    const normalized = String(value ?? '').trim()

    if (!/^(Expo(nent)?PushToken)\[[A-Za-z0-9_-]+\]$/.test(normalized)) {
      return null
    }

    return normalized
  }

  function normalizeFcmPushToken(value) {
    const normalized = String(value ?? '').trim()

    if (!/^[A-Za-z0-9:_-]{80,}$/.test(normalized)) {
      return null
    }

    return normalized
  }

  function normalizeMobilePushTokenProvider(value) {
    const normalized = String(value ?? '').trim().toLowerCase()

    if ([mobilePushTokenProviderExpo, mobilePushTokenProviderFcm].includes(normalized)) {
      return normalized
    }

    return null
  }

  function normalizeAnyPushToken(value, providerHint) {
    const provider = normalizeMobilePushTokenProvider(providerHint)
    const expoToken = normalizeExpoPushToken(value)
    const fcmToken = normalizeFcmPushToken(value)

    if (provider === mobilePushTokenProviderExpo && expoToken) {
      return {
        token: expoToken,
        tokenProvider: mobilePushTokenProviderExpo,
      }
    }

    if (provider === mobilePushTokenProviderFcm && fcmToken) {
      return {
        token: fcmToken,
        tokenProvider: mobilePushTokenProviderFcm,
      }
    }

    if (expoToken) {
      return {
        token: expoToken,
        tokenProvider: mobilePushTokenProviderExpo,
      }
    }

    if (fcmToken) {
      return {
        token: fcmToken,
        tokenProvider: mobilePushTokenProviderFcm,
      }
    }

    return null
  }

  function isPushTokenUnregisteredError(errorValue) {
    const normalized = String(errorValue ?? '').trim().toLowerCase()

    if (!normalized) {
      return false
    }

    return normalized.includes('devicenotregistered')
      || normalized.includes('registration-token-not-registered')
      || normalized.includes('invalid-registration-token')
  }

  function normalizeMobileAlertTargetMode(value) {
    const normalized = String(value ?? '').trim().toLowerCase()

    if ([mobileAlertTargetModeAll, mobileAlertTargetModeSelected].includes(normalized)) {
      return normalized
    }

    return null
  }

  function chunkArray(values, chunkSize) {
    const result = []

    for (let index = 0; index < values.length; index += chunkSize) {
      result.push(values.slice(index, index + chunkSize))
    }

    return result
  }

  function redactPushTokenForLog(value) {
    const normalized = String(value ?? '').trim()

    if (!normalized) {
      return null
    }

    if (normalized.length <= 12) {
      return `${normalized.slice(0, 4)}...`
    }

    return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`
  }

  function toPublicMobileAlert(document) {
    const targetMode =
      normalizeMobileAlertTargetMode(document?.targetMode)
      ?? mobileAlertTargetModeSelected
    const targetUserUids = Array.isArray(document?.targetUserUids)
      ? document.targetUserUids.map((value) => String(value ?? '').trim()).filter(Boolean)
      : []
    const delivery = document?.delivery ?? {}

    return {
      id: String(document?.id ?? '').trim(),
      title: String(document?.title ?? '').trim(),
      message: String(document?.message ?? '').trim(),
      isUpdate: document?.isUpdate === true,
      targetMode,
      targetUserCount: toNonNegativeInteger(delivery.targetUserCount || targetUserUids.length),
      pushTokenCount: toNonNegativeInteger(delivery.pushTokenCount),
      pushAcceptedCount: toNonNegativeInteger(delivery.pushAcceptedCount),
      pushErrorCount: toNonNegativeInteger(delivery.pushErrorCount),
      createdAt: String(document?.createdAt ?? '').trim() || null,
      createdByUid: String(document?.createdByUid ?? '').trim() || null,
      createdByEmail: String(document?.createdByEmail ?? '').trim() || null,
    }
  }

  async function sendExpoPushMessages(messages) {
    const messageList = Array.isArray(messages) ? messages : []

    if (messageList.length === 0) {
      return {
        acceptedCount: 0,
        errorEntries: [],
      }
    }

    const chunks = chunkArray(messageList, 100)
    let acceptedCount = 0
    const errorEntries = []

    for (const chunk of chunks) {
      let response
      let payload = {}

      try {
        response = await fetch(expoPushApiUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chunk),
        })
        payload = await response.json().catch(() => ({}))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Push delivery failed.'

        chunk.forEach((entry) => {
          errorEntries.push({
            token: String(entry?.to ?? '').trim(),
            error: message,
          })
        })
        continue
      }

      if (!response.ok) {
        const message = String(
          payload?.errors?.[0]?.message
          ?? payload?.message
          ?? `Push request failed with status ${response.status}.`,
        )

        chunk.forEach((entry) => {
          errorEntries.push({
            token: String(entry?.to ?? '').trim(),
            error: message,
          })
        })
        continue
      }

      const rows = Array.isArray(payload?.data) ? payload.data : []

      chunk.forEach((entry, index) => {
        const result = rows[index] ?? null

        if (result?.status === 'ok') {
          acceptedCount += 1
          return
        }

        errorEntries.push({
          token: String(entry?.to ?? '').trim(),
          error: String(result?.details?.error ?? result?.message ?? 'Push delivery failed.'),
        })
      })
    }

    return {
      acceptedCount,
      errorEntries,
    }
  }

  async function sendFcmPushMessages({
    tokens,
    title,
    body,
    data,
  }) {
    const tokenList = Array.isArray(tokens)
      ? Array.from(
        new Set(
          tokens
            .map((value) => normalizeFcmPushToken(value))
            .filter(Boolean),
        ),
      )
      : []

    if (tokenList.length === 0) {
      return {
        acceptedCount: 0,
        errorEntries: [],
      }
    }

    const chunks = chunkArray(tokenList, 500)
    const messaging = getMessaging()
    let acceptedCount = 0
    const errorEntries = []
    const normalizedData = Object.fromEntries(
      Object.entries(data ?? {}).map(([key, value]) => [key, String(value ?? '')]),
    )

    for (const chunk of chunks) {
      try {
        const response = await messaging.sendEachForMulticast({
          tokens: chunk,
          notification: {
            title,
            body,
          },
          data: normalizedData,
          android: {
            priority: 'high',
            notification: {
              channelId: 'alerts',
            },
          },
          apns: {
            headers: {
              'apns-priority': '10',
            },
          },
        })

        acceptedCount += toNonNegativeInteger(response.successCount)

        response.responses.forEach((result, index) => {
          if (result.success) {
            return
          }

          const errorCode = String(result.error?.code ?? '').trim()
          const errorMessage = String(result.error?.message ?? '').trim()
          const errorText = errorCode && errorMessage
            ? `${errorCode}: ${errorMessage}`
            : String(result.error?.code ?? result.error?.message ?? 'Push delivery failed.')

          errorEntries.push({
            token: chunk[index],
            error: errorText,
          })
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Push delivery failed.'

        chunk.forEach((token) => {
          errorEntries.push({
            token,
            error: message,
          })
        })
      }
    }

    return {
      acceptedCount,
      errorEntries,
    }
  }

  return {
    isPushTokenUnregisteredError,
    normalizeAnyPushToken,
    normalizeMobileAlertTargetMode,
    redactPushTokenForLog,
    sendExpoPushMessages,
    sendFcmPushMessages,
    toPublicMobileAlert,
  }
}
