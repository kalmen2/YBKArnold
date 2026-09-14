// Dealer linking backfill — a temporary admin tool.
//
// Orders only ever got a dealer link when they were created from a CRM quote.
// Everything that arrived through Monday (including the imported history) has
// the dealer name buried in free text: "EvensonBest / 250714" in the item name,
// or "EVE001-EVENSON BEST:250714" in the QuickBooks project. This tool reads
// that text, groups the orders by it, ranks CRM accounts against each group and
// lets an admin confirm the match once for the whole group.
//
// Delete this file, its registration in index.mjs, and DealerLinkingPage.tsx
// once the backfill is finished.

const DEALER_LINK_SOURCE_BACKFILL = 'manual_backfill'

// The business changed hands here. Orders before it are reference history.
const HANDOVER_DATE = '2026-03-08'

// Only true corporate-suffix noise. Words like "resources", "solutions" and
// "design" look generic but are exactly what separates Creative Office
// Resources from Creative Office Solutions, so they have to stay.
const GENERIC_NAME_WORDS = new Set([
  'inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'incorporated',
  'the', 'and', 'of',
])

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
])

function text(value, maxLength = 400) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function normalizeName(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function nameTokens(value) {
  return normalizeName(value).split(' ').filter(Boolean)
}

function identityTokens(value) {
  const tokens = nameTokens(value).filter((token) => !GENERIC_NAME_WORDS.has(token))
  // A name made entirely of generic words is still that dealer's name, so fall
  // back to the full token list rather than matching on nothing.
  return tokens.length > 0 ? tokens : nameTokens(value)
}

function squash(value) {
  return normalizeName(value).replace(/ /g, '')
}

function acronymOf(value) {
  return identityTokens(value).map((token) => token[0]).join('')
}

/**
 * Rank a CRM account name against the dealer text scraped off an order.
 * 0 means "no relationship at all"; anything above ~85 is worth pre-selecting.
 */
function scoreNameMatch(orderText, accountName) {
  const normalizedOrder = normalizeName(orderText)
  const normalizedAccount = normalizeName(accountName)

  if (!normalizedOrder || !normalizedAccount) {
    return 0
  }

  if (normalizedOrder === normalizedAccount) {
    return 100
  }

  const orderTokens = identityTokens(orderText)
  const accountTokens = identityTokens(accountName)

  if (orderTokens.length > 0 && orderTokens.join(' ') === accountTokens.join(' ')) {
    return 96
  }

  const squashedOrder = squash(orderText)
  const squashedAccount = squash(accountName)

  if (squashedOrder === squashedAccount) {
    return 98
  }

  // Short scraped text like "SOS", "AFD" or "COR" is an abbreviation. CRM names
  // usually carry it verbatim ("Studio Office Solutions (SOS) NYC"), so a whole
  // token hit is a much stronger signal than the token overlap below suggests.
  if (squashedOrder.length >= 2 && squashedOrder.length <= 5) {
    if (nameTokens(accountName).includes(squashedOrder)) {
      return 90
    }

    if (acronymOf(accountName) === squashedOrder) {
      return 86
    }
  }

  const orderSet = new Set(orderTokens)
  const accountSet = new Set(accountTokens)
  const shared = [...orderSet].filter((token) => accountSet.has(token))

  if (shared.length > 0) {
    const union = new Set([...orderSet, ...accountSet]).size
    const overlap = Math.round((shared.length / union) * 92)

    // "Dancker" vs "Dancker - NJ": every word of the shorter name is present,
    // which is a branch of the same dealer rather than a partial match.
    if (shared.length === Math.min(orderSet.size, accountSet.size)) {
      // Every word of the shorter name appears in the longer one. Rank the
      // fullest such match highest so "Benhar Office Interiors" beats "Benhar".
      const coverage = shared.length / Math.max(orderSet.size, accountSet.size)
      return Math.max(overlap, 70 + Math.round(8 * coverage))
    }

    return overlap
  }

  // Spacing differences ("EvensonBest" vs "Evenson Best - NYC") survive the
  // squash but not the token comparison above.
  const [shorter, longer] = squashedOrder.length <= squashedAccount.length
    ? [squashedOrder, squashedAccount]
    : [squashedAccount, squashedOrder]

  if (shorter.length >= 4 && longer.includes(shorter)) {
    return Math.round(50 + (40 * (shorter.length / longer.length)))
  }

  return 0
}

/**
 * "WOR001-THE WORKPLACE GROUP:250307" -> { code: 'WOR001', name: 'THE WORKPLACE GROUP' }
 */
function parseQuickBooksProjectName(value) {
  const projectName = text(value, 300)

  if (!projectName) {
    return null
  }

  const customer = projectName.split(':')[0].trim()

  if (!customer) {
    return null
  }

  const codeMatch = customer.match(/^([A-Z]{2,5}\d{1,4})\s*-\s*(.+)$/)

  return codeMatch
    ? { code: codeMatch[1], name: codeMatch[2].trim() }
    : { code: null, name: customer }
}

/**
 * Monday item names are "<Dealer> / <order number>", or just "<Dealer>" on the
 * older boards, sometimes with a job reference appended.
 */
function parseDealerTextFromOrderName(orderName, orderNumber) {
  let candidate = text(orderName, 300)

  if (!candidate) {
    return ''
  }

  const slashIndex = candidate.lastIndexOf('/')

  if (slashIndex > 0) {
    const tail = candidate.slice(slashIndex + 1).trim()
    const tailKey = tail.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const orderKeyText = text(orderNumber).toLowerCase().replace(/[^a-z0-9]+/g, '')

    if (/^\d/.test(tail) || (orderKeyText && tailKey === orderKeyText)) {
      candidate = candidate.slice(0, slashIndex).trim()
    }
  }

  return candidate
    .replace(/\s*#\s*\d+\s*$/, '')
    .replace(/\s*[-–]\s*\d{4,}\s*$/, '')
    .trim()
}

function resolveDealerText(orderDocument) {
  const fromQuickBooks = parseQuickBooksProjectName(
    orderDocument?.qb_project_name
    || orderDocument?.quickBooksProjectName
    || (Array.isArray(orderDocument?.quickbooks_project_names) ? orderDocument.quickbooks_project_names[0] : ''),
  )

  if (fromQuickBooks?.name) {
    return { label: fromQuickBooks.name, quickBooksCode: fromQuickBooks.code }
  }

  return {
    label: parseDealerTextFromOrderName(orderDocument?.order_name, orderDocument?.order_number ?? orderDocument?.orderNumber),
    quickBooksCode: null,
  }
}

/** Pull a US state out of a free-text ship-to address. */
function resolveShipToState(shipTo) {
  const address = text(shipTo, 400).toUpperCase()

  if (!address) {
    return null
  }

  const matches = address.match(/\b([A-Z]{2})\b(?=[\s,]*(?:\d{5}(?:-\d{4})?)?[\s,]*(?:USA?)?\s*$)/)

  if (matches && US_STATE_CODES.has(matches[1])) {
    return matches[1]
  }

  const allTwoLetterWords = address.match(/\b[A-Z]{2}\b/g) ?? []

  for (let index = allTwoLetterWords.length - 1; index >= 0; index -= 1) {
    if (US_STATE_CODES.has(allTwoLetterWords[index])) {
      return allTwoLetterWords[index]
    }
  }

  return null
}

export function registerDealerLinkingRoutes(app, deps) {
  const { getCollections, requireFirebaseAuth, toPublicAuthUser } = deps

  function requireAdmin(req, res) {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved || !publicUser?.isAdmin) {
      res.status(403).json({ error: 'Admin access is required.' })
      return null
    }

    return publicUser
  }

  app.get('/api/admin/dealer-linking', requireFirebaseAuth, async (req, res, next) => {
    try {
      if (!requireAdmin(req, res)) {
        return undefined
      }

      const { ordersUnifiedCollection, crmAccountsCollection } = await getCollections()

      const [orderDocuments, accountDocuments] = await Promise.all([
        ordersUnifiedCollection
          .find(
            { is_deleted: { $ne: true }, is_cancelled: { $ne: true } },
            {
              projection: {
                _id: 0,
                orderKey: 1,
                order_number: 1,
                orderNumber: 1,
                order_name: 1,
                ship_to: 1,
                order_date: 1,
                po_date: 1,
                orderValue: 1,
                ownership_era: 1,
                qb_project_name: 1,
                quickBooksProjectName: 1,
                quickbooks_project_names: 1,
                dealer_source_id: 1,
                dealerSourceId: 1,
                dealer_name: 1,
                dealerName: 1,
                dealer_link_not_applicable: 1,
              },
            },
          )
          .toArray(),
        crmAccountsCollection
          .find(
            { recordStatus: { $ne: 'deleted' } },
            { projection: { _id: 0, sourceId: 1, name: 1, city: 1, state: 1, isArchived: 1 } },
          )
          .toArray(),
      ])

      const accounts = accountDocuments
        .map((account) => ({
          sourceId: text(account?.sourceId, 160),
          name: text(account?.name, 240),
          city: text(account?.city, 120) || null,
          state: text(account?.state, 8).toUpperCase() || null,
          isArchived: account?.isArchived === true,
        }))
        .filter((account) => account.sourceId && account.name)

      let linkedCount = 0
      let skippedCount = 0
      let beforeHandoverCount = 0
      const groupsByKey = new Map()

      orderDocuments.forEach((orderDocument) => {
        const isLinked = Boolean(text(orderDocument?.dealer_source_id, 160) || text(orderDocument?.dealerSourceId, 160))

        if (isLinked) {
          linkedCount += 1
          return
        }

        if (orderDocument?.dealer_link_not_applicable === true) {
          skippedCount += 1
          return
        }

        // Only this company's own orders. The previous owner's history is
        // never quoted against or reported on by dealer, so linking it would
        // be a thousand rows of busywork for nothing.
        const orderDate = text(orderDocument?.order_date, 40).slice(0, 10)

        if (!orderDate || orderDate < HANDOVER_DATE || orderDocument?.ownership_era === 'prior_owner') {
          beforeHandoverCount += 1
          return
        }

        const { label, quickBooksCode } = resolveDealerText(orderDocument)
        const groupKey = normalizeName(label) || '(no name on the order)'
        const shipToState = resolveShipToState(orderDocument?.ship_to)

        if (!groupsByKey.has(groupKey)) {
          groupsByKey.set(groupKey, {
            key: groupKey,
            label: label || '(no name on the order)',
            orderCount: 0,
            states: new Set(),
            quickBooksCodes: new Set(),
            orders: [],
          })
        }

        const group = groupsByKey.get(groupKey)
        group.orderCount += 1

        if (shipToState) {
          group.states.add(shipToState)
        }

        if (quickBooksCode) {
          group.quickBooksCodes.add(quickBooksCode)
        }

        group.orders.push({
          orderKey: text(orderDocument?.orderKey, 200),
          orderNumber: text(orderDocument?.order_number, 120) || text(orderDocument?.orderNumber, 120),
          orderName: text(orderDocument?.order_name, 200),
          shipTo: text(orderDocument?.ship_to, 200) || null,
          shipToState,
          orderDate: text(orderDocument?.order_date, 40) || text(orderDocument?.po_date, 40) || null,
          orderValue: Number.isFinite(Number(orderDocument?.orderValue)) ? Number(orderDocument.orderValue) : null,
          isPriorOwner: text(orderDocument?.ownership_era, 40) === 'prior_owner',
        })
      })

      const groups = [...groupsByKey.values()]
        .map((group) => {
          const groupStates = [...group.states]
          const candidates = accounts
            .map((account) => {
              const baseScore = scoreNameMatch(group.label, account.name)

              if (baseScore <= 0) {
                return null
              }

              // Most near-ties are branches of one dealer. Where the order
              // shipped is the only thing that tells them apart.
              const shipsToAccountState = Boolean(account.state && groupStates.includes(account.state))
              const score = Math.min(100, baseScore + (shipsToAccountState ? 6 : 0) - (account.isArchived ? 10 : 0))

              return { ...account, score, matchesShipToState: shipsToAccountState }
            })
            .filter(Boolean)
            .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
            .slice(0, 6)

          return {
            key: group.key,
            label: group.label,
            orderCount: group.orderCount,
            states: groupStates.sort(),
            quickBooksCodes: [...group.quickBooksCodes].sort(),
            confidence: candidates[0]?.score ?? 0,
            orders: group.orders.sort((left, right) => left.orderNumber.localeCompare(right.orderNumber)),
            candidates,
          }
        })
        .sort((left, right) => right.orderCount - left.orderCount || left.label.localeCompare(right.label))

      return res.json({
        generatedAt: new Date().toISOString(),
        summary: {
          totalOrders: orderDocuments.length,
          linkedOrders: linkedCount,
          skippedOrders: skippedCount,
          beforeHandoverOrders: beforeHandoverCount,
          unlinkedOrders: groups.reduce((total, group) => total + group.orderCount, 0),
          groupCount: groups.length,
        },
        groups,
        accounts: accounts.map(({ sourceId, name, city, state, isArchived }) => ({
          sourceId, name, city, state, isArchived,
        })),
      })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/admin/dealer-linking/apply', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = requireAdmin(req, res)

      if (!publicUser) {
        return undefined
      }

      const action = text(req.body?.action, 20) || 'link'
      const orderKeys = (Array.isArray(req.body?.orderKeys) ? req.body.orderKeys : [])
        .map((orderKey) => text(orderKey, 200))
        .filter(Boolean)

      if (orderKeys.length === 0) {
        return res.status(400).json({ error: 'orderKeys is required.' })
      }

      if (!['link', 'skip', 'reset'].includes(action)) {
        return res.status(400).json({ error: 'action must be link, skip or reset.' })
      }

      const { ordersUnifiedCollection, crmAccountsCollection } = await getCollections()
      const now = new Date().toISOString()
      let update = null
      let dealerName = null

      if (action === 'link') {
        const dealerSourceId = text(req.body?.dealerSourceId, 160)

        if (!dealerSourceId) {
          return res.status(400).json({ error: 'dealerSourceId is required to link.' })
        }

        const account = await crmAccountsCollection.findOne(
          { sourceId: dealerSourceId, recordStatus: { $ne: 'deleted' } },
          { projection: { _id: 0, sourceId: 1, name: 1 } },
        )

        if (!account) {
          return res.status(404).json({ error: 'That CRM dealer was not found.' })
        }

        dealerName = text(account.name, 240)

        update = {
          // Both spellings are written because the readers are split: the
          // orders API reads dealer_source_id, the CRM API reads dealerSourceId.
          $set: {
            dealer_source_id: dealerSourceId,
            dealer_name: dealerName,
            dealerSourceId,
            dealerName,
            dealer_linked_at: now,
            dealer_linked_by_email: text(publicUser?.email, 200) || null,
            dealer_link_source: DEALER_LINK_SOURCE_BACKFILL,
          },
          $unset: { dealer_link_not_applicable: '' },
        }
      } else if (action === 'skip') {
        update = {
          $set: {
            dealer_link_not_applicable: true,
            dealer_link_skipped_at: now,
            dealer_link_skipped_by_email: text(publicUser?.email, 200) || null,
          },
        }
      } else {
        update = {
          $unset: {
            dealer_source_id: '',
            dealer_name: '',
            dealerSourceId: '',
            dealerName: '',
            dealer_linked_at: '',
            dealer_linked_by_email: '',
            dealer_link_source: '',
            dealer_link_not_applicable: '',
            dealer_link_skipped_at: '',
            dealer_link_skipped_by_email: '',
          },
        }
      }

      const result = await ordersUnifiedCollection.updateMany({ orderKey: { $in: orderKeys } }, update)

      return res.json({
        action,
        matchedCount: Number(result?.matchedCount ?? 0),
        modifiedCount: Number(result?.modifiedCount ?? 0),
        dealerName,
      })
    } catch (error) {
      return next(error)
    }
  })
}
