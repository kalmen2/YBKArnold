export function createPlatformConfigService({
  mondayApiToken,
  mondayBoardId,
  zendeskApiToken,
  zendeskEmail,
  zendeskUrl,
}) {
  function ensureMondayConfiguration() {
    if (!mondayApiToken) {
      throw {
        status: 500,
        message: 'Missing MONDAY_API_TOKEN in environment configuration.',
      }
    }

    if (!mondayBoardId) {
      throw {
        status: 500,
        message: 'Missing MONDAY_BOARD_ID in environment configuration.',
      }
    }
  }

  function ensureZendeskConfiguration() {
    if (!zendeskApiToken) {
      throw {
        status: 500,
        message: 'Missing ZENDESK_API_TOKEN in environment configuration.',
      }
    }

    if (!buildZendeskApiBaseUrl()) {
      throw {
        status: 500,
        message: 'Missing or invalid ZENDESK_URL in environment configuration.',
      }
    }
  }

  function buildZendeskOrigin() {
    if (!zendeskUrl) {
      return ''
    }

    let normalized = zendeskUrl.trim()

    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`
    }

    try {
      return new URL(normalized).origin
    } catch {
      return ''
    }
  }

  function buildZendeskApiBaseUrl() {
    const origin = buildZendeskOrigin()

    return origin ? `${origin}/api/v2` : ''
  }

  function buildZendeskAgentUrl() {
    const origin = buildZendeskOrigin()

    return origin ? `${origin}/agent` : ''
  }

  function buildZendeskAuthorizationHeader() {
    const credential = `${zendeskEmail}/token:${zendeskApiToken}`

    return `Basic ${Buffer.from(credential).toString('base64')}`
  }

  return {
    buildZendeskAgentUrl,
    buildZendeskApiBaseUrl,
    buildZendeskAuthorizationHeader,
    buildZendeskOrigin,
    ensureMondayConfiguration,
    ensureZendeskConfiguration,
  }
}
