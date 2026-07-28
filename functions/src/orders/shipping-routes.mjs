// Shipping endpoints: the website ship action (gated on signed BOL +
// inspection sheet, moves the Monday card to Shipped and syncs back) and the
// sub-order link that combines a family's money/labor on its main order.

import {
  buildOrderIdentityFilter,
  normalizeIsoDateInput,
  normalizeOrderNumberInput,
  normalizeProgressStatusDetails,
} from './order-shared.mjs'
import { MONDAY_BOARDS } from './monday-board-map.mjs'
import { normalizeOptionalShortText } from '../utils/value-utils.mjs'
import { getStorage } from 'firebase-admin/storage'

export function registerOrderShippingRoutes(app, {
  authApprovalApproved,
  createMondayItem,
  deleteMondayItem,
  fetchMondayBoardColumns,
  fetchMondayBoardsCatalog,
  fetchMondayBoardItemsByIds,
  getCollections,
  mobileAlertTargetModeSelected,
  moveMondayItemToBoard,
  normalizeEmail,
  randomUUID,
  refreshOrdersUnifiedCollection,
  requireFirebaseAuth,
  requireManagerOrAdminRole,
  toPublicAuthUser,
  toPublicMobileAlert,
  updateMondayItemJsonColumn,
  updateMondayItemName,
  updateMondayItemTextColumn,
}) {
  const orderTrackBoardId = String(MONDAY_BOARDS?.orderTrack?.id ?? '').trim()
  const manualOrderBoardPrefix = normalizeOptionalShortText(
    process.env.MONDAY_NEW_ORDERS_BOARD_PREFIX,
    80,
  ) || 'New Orders'
  const parsedManualOrderDefaultYear = Number.parseInt(
    String(process.env.MONDAY_NEW_ORDERS_DEFAULT_YEAR ?? '2026').trim(),
    10,
  )
  const manualOrderDefaultYear = Number.isFinite(parsedManualOrderDefaultYear)
    && parsedManualOrderDefaultYear >= 2000
    && parsedManualOrderDefaultYear <= 9999
    ? parsedManualOrderDefaultYear
    : 2026
  const mondayBoardUrlRoot = (() => {
    const configuredBoardUrl = String(process.env.MONDAY_BOARD_URL ?? '').trim()
    const matchedRoot = configuredBoardUrl.match(/^(https?:\/\/[^/]+\/boards)(?:\/\d+)?/i)

    if (matchedRoot?.[1]) {
      return String(matchedRoot[1]).trim()
    }

    return 'https://arnoldcontract.monday.com/boards'
  })()

  function escapeRegex(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function extractFirebaseStorageTarget(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl ?? '').trim())
      const match = parsed.hostname === 'firebasestorage.googleapis.com'
        ? parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/)
        : null
      if (!match) return null
      const target = { bucketName: decodeURIComponent(match[1]), objectPath: decodeURIComponent(match[2]) }
      return target.objectPath.startsWith('crm/orders/') ? target : null
    } catch {
      return null
    }
  }

  async function deleteGeneratedOrderDocuments(orderDocument) {
    const targets = [
      orderDocument?.deposit_request_url,
      orderDocument?.order_confirmation_url,
      orderDocument?.work_order_url,
    ]
      .map(extractFirebaseStorageTarget)
      .filter(Boolean)
    const results = await Promise.all(targets.map(async (target) => {
      try {
        await getStorage().bucket(target.bucketName).file(target.objectPath).delete({ ignoreNotFound: true })
        return true
      } catch {
        return false
      }
    }))
    return { attemptedCount: targets.length, deletedCount: results.filter(Boolean).length, failedCount: results.filter((result) => !result).length }
  }

  function buildManualOrderKey(orderNumber, mondayItemId) {
    const normalizedOrderKey = String(orderNumber ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
    const normalizedMondayItemId = String(mondayItemId ?? '').trim()

    if (normalizedOrderKey) {
      return `order:${normalizedOrderKey}`
    }

    if (normalizedMondayItemId) {
      return `monday:${normalizedMondayItemId}`
    }

    return ''
  }

  function parseOptionalMoneyInput(value, fieldName) {
    const normalized = String(value ?? '').trim()

    if (!normalized) {
      return { value: null, error: null }
    }

    const cleaned = normalized.replace(/[$,\s]/g, '')
    const parsed = Number(cleaned)

    if (!Number.isFinite(parsed) || parsed < 0) {
      return {
        value: null,
        error: `${fieldName} must be a non-negative number.`,
      }
    }

    return {
      value: Number(parsed.toFixed(2)),
      error: null,
    }
  }

  function requireOfficeManagerOrAdminRole(req, _res, next) {
    const publicUser = toPublicAuthUser(req.authUser)
    const hasAccess = Boolean(
      publicUser?.isApproved
      && (
        publicUser?.isOwner
        || publicUser?.isAdmin
        || publicUser?.isManager
        || publicUser?.isOfficeWorker
      ),
    )

    if (!hasAccess) {
      return next({
        status: 403,
        message: 'Office, manager, or admin access is required.',
      })
    }

    next()
  }

  function normalizeBoardLabel(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
  }

  const normalizedManualOrderBoardPrefix = normalizeBoardLabel(manualOrderBoardPrefix)

  function parseManualOrderBoardYear(boardName) {
    const normalizedName = normalizeBoardLabel(boardName)

    if (!normalizedName || !normalizedManualOrderBoardPrefix) {
      return null
    }

    const yearMatch = normalizedName.match(new RegExp(`^${escapeRegex(normalizedManualOrderBoardPrefix)}\\s+(\\d{4})$`))

    if (!yearMatch?.[1]) {
      return null
    }

    const year = Number.parseInt(yearMatch[1], 10)

    if (!Number.isFinite(year) || year < 2000 || year > 9999) {
      return null
    }

    return year
  }

  function buildMondayBoardUrl(boardId) {
    const normalizedBoardId = String(boardId ?? '').trim()

    if (!normalizedBoardId) {
      return null
    }

    return `${mondayBoardUrlRoot}/${normalizedBoardId}`
  }

  function normalizeManualOrderBoardOption(board) {
    const boardId = String(board?.id ?? '').trim()
    const boardName = String(board?.name ?? '').trim()
    const boardYear = parseManualOrderBoardYear(boardName)

    if (!boardId || !boardName || !boardYear || boardYear < manualOrderDefaultYear) {
      return null
    }

    return {
      boardId,
      boardName,
      boardYear,
      boardUrl: buildMondayBoardUrl(boardId),
      isDefault: boardYear === manualOrderDefaultYear,
    }
  }

  async function resolveManualOrderBoardOptions({
    includeFutureYears = false,
    forceRefresh = false,
  } = {}) {
    const boardsCatalog = await fetchMondayBoardsCatalog({ forceRefresh })
    const allBoardOptions = (Array.isArray(boardsCatalog) ? boardsCatalog : [])
      .map((board) => normalizeManualOrderBoardOption(board))
      .filter(Boolean)
      .sort((left, right) => {
        const yearCompare = Number(left.boardYear) - Number(right.boardYear)

        if (yearCompare !== 0) {
          return yearCompare
        }

        return String(left.boardName ?? '').localeCompare(String(right.boardName ?? ''))
      })

    const defaultBoard = allBoardOptions.find((board) => board.isDefault) || null

    if (!defaultBoard) {
      throw {
        status: 500,
        message: `Could not find Monday board "${manualOrderBoardPrefix} ${manualOrderDefaultYear}".`,
      }
    }

    const visibleBoards = includeFutureYears
      ? allBoardOptions.filter((board) => board.boardYear >= manualOrderDefaultYear)
      : [defaultBoard]

    return {
      defaultBoard,
      boards: visibleBoards,
      boardsById: new Map(visibleBoards.map((board) => [board.boardId, board])),
    }
  }

  async function resolveManualOrderTargetBoard(requestedBoardId) {
    const normalizedRequestedBoardId = String(requestedBoardId ?? '').trim()
    const { defaultBoard, boardsById } = await resolveManualOrderBoardOptions({
      includeFutureYears: true,
    })

    if (!normalizedRequestedBoardId) {
      return defaultBoard
    }

    const selectedBoard = boardsById.get(normalizedRequestedBoardId)

    if (!selectedBoard) {
      throw {
        status: 400,
        message: `Selected board is not allowed. Choose a ${manualOrderBoardPrefix} board from ${manualOrderDefaultYear} or newer.`,
      }
    }

    return selectedBoard
  }

  function normalizeColumnTitle(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/[^a-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
  }

  function resolveBoardColumnId(columns, {
    idCandidates = [],
    titleCandidates = [],
    preferredTypes = [],
  } = {}) {
    const normalizedColumns = (Array.isArray(columns) ? columns : [])
      .map((column) => {
        const columnId = String(column?.id ?? '').trim()

        if (!columnId) {
          return null
        }

        return {
          id: columnId,
          normalizedId: columnId.toLowerCase(),
          title: String(column?.title ?? '').trim(),
          normalizedTitle: normalizeColumnTitle(column?.title),
          type: String(column?.type ?? '').trim().toLowerCase(),
        }
      })
      .filter(Boolean)

    const normalizedIdCandidates = [...new Set(
      (Array.isArray(idCandidates) ? idCandidates : [])
        .map((value) => String(value ?? '').trim().toLowerCase())
        .filter(Boolean),
    )]
    const normalizedTitleCandidates = [...new Set(
      (Array.isArray(titleCandidates) ? titleCandidates : [])
        .map((value) => normalizeColumnTitle(value))
        .filter(Boolean),
    )]
    const normalizedPreferredTypes = new Set(
      (Array.isArray(preferredTypes) ? preferredTypes : [])
        .map((value) => String(value ?? '').trim().toLowerCase())
        .filter(Boolean),
    )

    const typeMatches = (entry) => {
      if (normalizedPreferredTypes.size === 0) {
        return true
      }

      return normalizedPreferredTypes.has(String(entry?.type ?? '').trim().toLowerCase())
    }

    for (const candidateId of normalizedIdCandidates) {
      const match = normalizedColumns.find((entry) => entry.normalizedId === candidateId && typeMatches(entry))

      if (match?.id) {
        return match.id
      }
    }

    for (const candidateTitle of normalizedTitleCandidates) {
      const exactMatch = normalizedColumns.find(
        (entry) => entry.normalizedTitle === candidateTitle && typeMatches(entry),
      )

      if (exactMatch?.id) {
        return exactMatch.id
      }
    }

    for (const candidateTitle of normalizedTitleCandidates) {
      const looseMatch = normalizedColumns.find(
        (entry) => entry.normalizedTitle.includes(candidateTitle) && typeMatches(entry),
      )

      if (looseMatch?.id) {
        return looseMatch.id
      }
    }

    return null
  }

  function buildManualOrderColumnMap(columns) {
    return {
      ackColumnId: resolveBoardColumnId(columns, {
        idCandidates: ['text9'],
        titleCandidates: [
          'ack',
          'ack #',
          'ack number',
          'acknowledgement number',
          'acknowledgment number',
          'order number',
        ],
      }),
      poDateColumnId: resolveBoardColumnId(columns, {
        idCandidates: ['date7', 'date'],
        titleCandidates: ['po date', 'order date'],
        preferredTypes: ['date'],
      }),
      poNumberColumnId: resolveBoardColumnId(columns, {
        idCandidates: ['text2'],
        titleCandidates: ['po number', 'po #', 'po'],
      }),
      descriptionColumnId: resolveBoardColumnId(columns, {
        idCandidates: ['text81'],
        titleCandidates: ['description', 'order description'],
      }),
      shipToColumnId: resolveBoardColumnId(columns, {
        idCandidates: ['location'],
        titleCandidates: ['ship to', 'shipping address'],
      }),
      notesColumnId: resolveBoardColumnId(columns, {
        idCandidates: ['text_mkpymfhb', 'text95'],
        titleCandidates: ['notes', 'note'],
      }),
      peopleColumnId: resolveBoardColumnId(columns, {
        idCandidates: ['people'],
        titleCandidates: ['sales rep', 'sales person', 'people'],
        preferredTypes: ['multiple-person', 'people'],
      }),
    }
  }

  async function resolveDeleteRequestRecipientUids(authUsersCollection) {
    const approvedUsers = await authUsersCollection
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

    return approvedUsers
      .map((document) => toPublicAuthUser(document))
      .filter((user) => Boolean(user?.uid && user.isApproved && (user.isAdmin || user.isOwner)))
      .map((user) => String(user.uid))
  }

  async function createOrderDeleteRequestAdminAlert({
    authUsersCollection,
    mobileAlertsCollection,
    publicUser,
    order,
    reason,
  }) {
    const recipientUids = await resolveDeleteRequestRecipientUids(authUsersCollection)

    if (recipientUids.length === 0) {
      throw {
        status: 404,
        message: 'No approved admin/owner recipients found.',
      }
    }

    const senderLabel = normalizeOptionalShortText(publicUser?.displayName, 120)
      || normalizeOptionalShortText(publicUser?.email, 200)
      || 'A team member'
    const orderNumber = normalizeOrderNumberInput(order?.orderNumber) || '(unknown)'
    const orderName = normalizeOptionalShortText(order?.orderName, 260) || null
    const mondayItemId = String(order?.mondayItemId ?? '').trim() || null
    const quickBooksProjectIds = Array.isArray(order?.quickBooksProjectIds)
      ? [...new Set(order.quickBooksProjectIds.map((value) => String(value ?? '').trim()).filter(Boolean))]
      : []
    const quickBooksSuffix = quickBooksProjectIds.length > 0
      ? ` Linked QuickBooks project IDs: ${quickBooksProjectIds.join(', ')}.`
      : ''
    const reasonSuffix = reason
      ? ` Reason: ${reason}`
      : ''
    const now = new Date().toISOString()
    const alertDocument = {
      id: randomUUID(),
      title: 'Order Delete Request',
      message:
        `${senderLabel} requested deletion for order ${orderNumber}`
        + (orderName ? ` (${orderName})` : '')
        + (mondayItemId ? ` [Monday ${mondayItemId}]` : '')
        + '.'
        + quickBooksSuffix
        + reasonSuffix,
      isUpdate: false,
      targetMode: mobileAlertTargetModeSelected,
      targetUserUids: recipientUids,
      createdByUid: String(publicUser?.uid ?? '').trim() || null,
      createdByEmail: normalizeEmail(publicUser?.email) || null,
      delivery: {
        targetUserCount: recipientUids.length,
        pushTokenCount: 0,
        pushAcceptedCount: 0,
        pushErrorCount: 0,
        errorSamples: [],
      },
      metadata: {
        type: 'orders_delete_request',
        orderNumber,
        orderName,
        mondayItemId,
        orderKey: String(order?.orderKey ?? '').trim() || null,
        quickBooksProjectIds,
        quickBooksProjectNames: Array.isArray(order?.quickBooksProjectNames)
          ? [...new Set(order.quickBooksProjectNames.map((value) => String(value ?? '').trim()).filter(Boolean))]
          : [],
        hasQuickBooksRecord: Boolean(order?.hasQuickBooksRecord),
        reason: reason || null,
        sourceUid: String(publicUser?.uid ?? '').trim() || null,
        sourceEmail: normalizeEmail(publicUser?.email) || null,
      },
      createdAt: now,
      updatedAt: now,
    }

    await mobileAlertsCollection.insertOne(alertDocument)

    return alertDocument
  }

  // GET /api/orders/create/boards — list allowed New Orders boards for manual
  // create. Initial list returns default year only; refresh includes newer.
  app.get(
    '/api/orders/create/boards',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const refreshQuery = String(req.query?.refresh ?? '').trim().toLowerCase()
        const shouldRefresh = refreshQuery === '1'
          || refreshQuery === 'true'
          || refreshQuery === 'yes'

        const { defaultBoard, boards } = await resolveManualOrderBoardOptions({
          includeFutureYears: shouldRefresh,
          forceRefresh: shouldRefresh,
        })

        return res.json({
          ok: true,
          defaultYear: manualOrderDefaultYear,
          defaultBoardId: defaultBoard.boardId,
          boards: boards.map((board) => ({
            id: board.boardId,
            name: board.boardName,
            year: board.boardYear,
            isDefault: board.isDefault,
            url: board.boardUrl,
          })),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // GET /api/orders/create/board-columns — list all columns on a selected New
  // Orders board so field exposure can be configured safely.
  app.get(
    '/api/orders/create/board-columns',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const requestedBoardId = String(req.query?.boardId ?? '').trim()
        const selectedBoard = await resolveManualOrderTargetBoard(requestedBoardId)
        const boardSnapshot = await fetchMondayBoardColumns({
          boardId: selectedBoard.boardId,
        })
        const resolvedBoardName = String(boardSnapshot?.board?.name ?? '').trim()
          || selectedBoard.boardName

        return res.json({
          ok: true,
          board: {
            id: selectedBoard.boardId,
            name: resolvedBoardName,
            year: selectedBoard.boardYear,
            isDefault: selectedBoard.isDefault,
            url: selectedBoard.boardUrl,
          },
          columns: (Array.isArray(boardSnapshot?.columns) ? boardSnapshot.columns : []).map((column) => ({
            id: String(column?.id ?? '').trim(),
            title: String(column?.title ?? '').trim() || null,
            type: String(column?.type ?? '').trim() || null,
          })),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/create — manually create a new order card in Monday and
  // persist it to the website collections.
  app.post(
    '/api/orders/create',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const requestedAccountName = normalizeOptionalShortText(
          req.body?.accountName ?? req.body?.name ?? req.body?.orderName,
          260,
        )
        const requestedAcknowledgement = normalizeOrderNumberInput(
          req.body?.acknowledgementNumber
          ?? req.body?.ack
          ?? req.body?.orderNumber,
        )
        const requestedSalesRep = normalizeOptionalShortText(req.body?.salesRep, 200) || null
        const requestedPoDateRaw = String(req.body?.poDate ?? '').trim()
        const requestedPoDate = normalizeIsoDateInput(requestedPoDateRaw)
        const requestedPoNumber = normalizeOptionalShortText(req.body?.poNumber, 120) || null
        const requestedDescription = normalizeOptionalShortText(req.body?.description, 2000) || null
        const requestedShipTo = normalizeOptionalShortText(req.body?.shipTo, 500) || null
        const requestedNotes = normalizeOptionalShortText(req.body?.notes, 2000) || null
        const requestedReasonableName = `${requestedAccountName || ''}`.trim()

        if (!requestedAcknowledgement) {
          return res.status(400).json({
            error: 'acknowledgementNumber is required.',
          })
        }

        if (!requestedReasonableName) {
          return res.status(400).json({
            error: 'name or accountName is required.',
          })
        }

        if (requestedPoDateRaw && !requestedPoDate) {
          return res.status(400).json({
            error: 'poDate must be YYYY-MM-DD.',
          })
        }

        const parsedOrderValue = parseOptionalMoneyInput(req.body?.orderValue, 'orderValue')

        if (parsedOrderValue.error) {
          return res.status(400).json({
            error: parsedOrderValue.error,
          })
        }

        const parsedFreightValue = parseOptionalMoneyInput(req.body?.freightValue, 'freightValue')

        if (parsedFreightValue.error) {
          return res.status(400).json({
            error: parsedFreightValue.error,
          })
        }

        const selectedBoard = await resolveManualOrderTargetBoard(req.body?.boardId)
        const selectedBoardSnapshot = await fetchMondayBoardColumns({
          boardId: selectedBoard.boardId,
        })
        const selectedBoardName = String(selectedBoardSnapshot?.board?.name ?? '').trim()
          || selectedBoard.boardName
        const selectedBoardUrl = selectedBoard.boardUrl
        const {
          ackColumnId,
          poDateColumnId,
          poNumberColumnId,
          descriptionColumnId,
          shipToColumnId,
          notesColumnId,
          peopleColumnId,
        } = buildManualOrderColumnMap(selectedBoardSnapshot?.columns)

        const {
          crmQuotesCollection,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()
        const duplicateOrder = await ordersUnifiedCollection.findOne(
          {
            order_number: new RegExp(`^${escapeRegex(requestedAcknowledgement)}$`, 'i'),
            is_deleted: { $ne: true },
          },
          {
            projection: {
              _id: 0,
              order_number: 1,
              order_name: 1,
              monday_item_id: 1,
            },
          },
        )

        if (duplicateOrder) {
          return res.status(409).json({
            error: 'An order with this acknowledgement number already exists.',
            order: {
              orderNumber: String(duplicateOrder?.order_number ?? '').trim() || null,
              orderName: String(duplicateOrder?.order_name ?? '').trim() || null,
              mondayItemId: String(duplicateOrder?.monday_item_id ?? '').trim() || null,
            },
          })
        }

        const itemName = `${requestedReasonableName} / ${requestedAcknowledgement}`
        const createdItem = await createMondayItem({
          boardId: selectedBoard.boardId,
          itemName,
        })
        const mondayItemId = String(createdItem?.itemId ?? '').trim()

        if (!mondayItemId) {
          return res.status(502).json({
            error: 'Monday did not return the created item id.',
          })
        }

        const warnings = []
        if (!ackColumnId) {
          warnings.push(`ACK was saved in item name, but ${selectedBoardName} has no mapped ACK column.`)
        }

        await updateMondayItemName({
          boardId: selectedBoard.boardId,
          itemId: mondayItemId,
          itemName,
        })

        if (ackColumnId) {
          await updateMondayItemTextColumn({
            boardId: selectedBoard.boardId,
            itemId: mondayItemId,
            columnId: ackColumnId,
            textValue: requestedAcknowledgement,
          })
        }

        const runOptionalMondayUpdate = async (label, callback) => {
          try {
            await callback()
          } catch (error) {
            warnings.push(
              `${label} was saved on website but could not be synced to Monday (${normalizeOptionalShortText(error?.message, 180) || 'unknown error'}).`,
            )
          }
        }

        if (requestedPoDate) {
          if (!poDateColumnId) {
            warnings.push(`PO Date was saved on website but ${selectedBoardName} has no mapped PO date column.`)
          } else {
            await runOptionalMondayUpdate('PO Date', async () => {
              await updateMondayItemJsonColumn({
                boardId: selectedBoard.boardId,
                itemId: mondayItemId,
                columnId: poDateColumnId,
                jsonValue: {
                  date: requestedPoDate,
                },
              })
            })
          }
        }

        if (requestedPoNumber) {
          if (!poNumberColumnId) {
            warnings.push(`PO Number was saved on website but ${selectedBoardName} has no mapped PO number column.`)
          } else {
            await runOptionalMondayUpdate('PO Number', async () => {
              await updateMondayItemTextColumn({
                boardId: selectedBoard.boardId,
                itemId: mondayItemId,
                columnId: poNumberColumnId,
                textValue: requestedPoNumber,
              })
            })
          }
        }

        if (requestedDescription) {
          if (!descriptionColumnId) {
            warnings.push(`Description was saved on website but ${selectedBoardName} has no mapped description column.`)
          } else {
            await runOptionalMondayUpdate('Description', async () => {
              await updateMondayItemTextColumn({
                boardId: selectedBoard.boardId,
                itemId: mondayItemId,
                columnId: descriptionColumnId,
                textValue: requestedDescription,
              })
            })
          }
        }

        if (requestedShipTo) {
          if (!shipToColumnId) {
            warnings.push(`Ship To was saved on website but ${selectedBoardName} has no mapped Ship To column.`)
          } else {
            await runOptionalMondayUpdate('Ship To', async () => {
              await updateMondayItemTextColumn({
                boardId: selectedBoard.boardId,
                itemId: mondayItemId,
                columnId: shipToColumnId,
                textValue: requestedShipTo,
              })
            })
          }
        }

        if (requestedNotes) {
          if (!notesColumnId) {
            warnings.push(`Notes were saved on website but ${selectedBoardName} has no mapped Notes column.`)
          } else {
            await runOptionalMondayUpdate('Notes', async () => {
              await updateMondayItemTextColumn({
                boardId: selectedBoard.boardId,
                itemId: mondayItemId,
                columnId: notesColumnId,
                textValue: requestedNotes,
              })
            })
          }
        }

        if (requestedSalesRep) {
          if (!peopleColumnId) {
            warnings.push(`Sales Rep was saved on website but ${selectedBoardName} has no mapped Sales Rep/People column.`)
          } else {
            await runOptionalMondayUpdate('Sales Rep', async () => {
              await updateMondayItemTextColumn({
                boardId: selectedBoard.boardId,
                itemId: mondayItemId,
                columnId: peopleColumnId,
                textValue: requestedSalesRep,
              })
            })
          }
        }

        if (parsedOrderValue.value !== null) {
          warnings.push('Order value was saved on website. Monday order-value column mapping is not configured yet.')
        }

        if (parsedFreightValue.value !== null) {
          warnings.push('Freight value was saved on website. Monday freight column mapping is not configured yet.')
        }

        const snapshot = await fetchMondayBoardItemsByIds({
          boardId: selectedBoard.boardId,
          boardName: selectedBoardName,
          boardUrl: selectedBoardUrl,
          itemIds: [mondayItemId],
        })
        const liveOrder = Array.isArray(snapshot?.orders)
          ? snapshot.orders[0]
          : null
        const now = new Date().toISOString()
        const mondayUpdatedAt = String(liveOrder?.updatedAt ?? '').trim() || now
        const resolvedOrderNumber = normalizeOrderNumberInput(
          liveOrder?.jobNumber,
        ) || requestedAcknowledgement
        const resolvedOrderName = normalizeOptionalShortText(
          liveOrder?.name,
          260,
        ) || itemName
        const resolvedPoDate = normalizeIsoDateInput(liveOrder?.orderDate) || requestedPoDate || null
        const resolvedPoNumber = normalizeOptionalShortText(liveOrder?.poNumber, 120)
          || requestedPoNumber
          || null
        const resolvedDescription = normalizeOptionalShortText(liveOrder?.description, 2000)
          || requestedDescription
          || null
        const resolvedShipTo = normalizeOptionalShortText(liveOrder?.shipTo, 500)
          || requestedShipTo
          || null
        const resolvedNotes = normalizeOptionalShortText(liveOrder?.notes, 2000)
          || requestedNotes
          || null
        const resolvedOrderKey = buildManualOrderKey(resolvedOrderNumber, mondayItemId) || `monday:${mondayItemId}`
        const pendingPlacementHazardReason =
          'Pending: created in New Orders and waiting to appear in Design or Orders.'
        const progressStatusDetails = normalizeProgressStatusDetails(liveOrder?.progressStatusDetails)
        const leadTimeDays = Number.isFinite(Number(liveOrder?.leadTimeDays))
          ? Number(liveOrder.leadTimeDays)
          : null
        const progressPercent = Number.isFinite(Number(liveOrder?.progressPercent))
          ? Number(liveOrder.progressPercent)
          : null
        const publicUser = toPublicAuthUser(req.authUser)

        await Promise.all([
          mondayOrdersCollection.updateOne(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                mondayBoardId: selectedBoard.boardId,
                mondayBoardName: selectedBoardName,
                mondayBoardUrl: selectedBoardUrl,
                orderName: resolvedOrderName,
                jobNumber: resolvedOrderNumber,
                poNumber: resolvedPoNumber,
                notes: resolvedNotes,
                description: resolvedDescription,
                orderDate: resolvedPoDate,
                dueDate: normalizeIsoDateInput(liveOrder?.dueDate) || null,
                leadTimeDays,
                progressPercent,
                progressStatusDetails,
                stageLabel: normalizeOptionalShortText(liveOrder?.stageLabel, 200) || null,
                readyLabel: normalizeOptionalShortText(liveOrder?.readyLabel, 200) || null,
                statusLabel: normalizeOptionalShortText(liveOrder?.statusLabel, 200) || null,
                shipTo: resolvedShipTo,
                shipNotes: normalizeOptionalShortText(liveOrder?.shipNotes, 2000) || null,
                mondayItemUrl: String(liveOrder?.itemUrl ?? '').trim() || null,
                mondayUpdatedAt,
                manualSalesRep: requestedSalesRep,
                manualOrderValue: parsedOrderValue.value,
                manualFreightValue: parsedFreightValue.value,
                updatedAt: now,
                lastSeenAt: now,
              },
              $setOnInsert: {
                createdAt: now,
              },
            },
            { upsert: true },
          ),
          ordersUnifiedCollection.updateOne(
            { orderKey: resolvedOrderKey },
            {
              $set: {
                orderKey: resolvedOrderKey,
                order_number: resolvedOrderNumber,
                monday_item_id: mondayItemId,
                Monday_url: String(liveOrder?.itemUrl ?? '').trim() || null,
                Monday_status: normalizeOptionalShortText(liveOrder?.statusLabel, 260) || null,
                order_name: resolvedOrderName,
                ship_to: resolvedShipTo,
                ship_notes: normalizeOptionalShortText(liveOrder?.shipNotes, 2000) || null,
                po_number: resolvedPoNumber,
                monday_notes: resolvedNotes,
                monday_description: resolvedDescription,
                order_date: resolvedPoDate,
                Due_date: normalizeIsoDateInput(liveOrder?.dueDate) || null,
                Lead_time_days: leadTimeDays,
                progress_percent: progressPercent,
                progress_status_details: progressStatusDetails,
                has_monday_record: true,
                has_quickbooks_record: false,
                in_design: true,
                is_shipped: false,
                source: 'monday',
                monday_board_id: selectedBoard.boardId,
                monday_board_name: selectedBoardName,
                monday_updated_at: mondayUpdatedAt,
                poAmount: parsedOrderValue.value,
                orderValue: parsedOrderValue.value,
                freightValue: parsedFreightValue.value,
                website_calculated_order_total: parsedOrderValue.value === null
                  ? null
                  : Number((
                    Number(parsedOrderValue.value)
                    + Number(parsedFreightValue.value || 0)
                  ).toFixed(2)),
                website_calculated_order_total_at: parsedOrderValue.value === null ? null : now,
                sales_rep: requestedSalesRep,
                created_via_website_manual_at: now,
                created_via_website_manual_by_uid: String(publicUser?.uid ?? '').trim() || null,
                created_via_website_manual_by_email: normalizeEmail(publicUser?.email) || null,
                hazard_reason: pendingPlacementHazardReason,
                updatedAt: now,
                lastSyncedAt: now,
              },
              $setOnInsert: {
                createdAt: now,
                status: [],
              },
            },
            { upsert: true },
          ),
        ])

        try {
          await refreshOrdersUnifiedCollection()
        } catch (refreshError) {
          warnings.push(
            refreshError instanceof Error
              ? refreshError.message
              : 'Order was created, but orders refresh failed.',
          )
        }

        return res.status(201).json({
          ok: true,
          order: {
            orderKey: resolvedOrderKey,
            mondayItemId,
            orderNumber: resolvedOrderNumber,
            orderName: resolvedOrderName,
            mondayItemUrl: String(liveOrder?.itemUrl ?? '').trim() || null,
            poDate: resolvedPoDate,
            poNumber: resolvedPoNumber,
            description: resolvedDescription,
            shipTo: resolvedShipTo,
            notes: resolvedNotes,
            salesRep: requestedSalesRep,
            orderValue: parsedOrderValue.value,
            freightValue: parsedFreightValue.value,
            mondayBoardId: selectedBoard.boardId,
            mondayBoardName: selectedBoardName,
            mondayBoardYear: selectedBoard.boardYear,
            mondayUpdatedAt,
          },
          warnings,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/order-confirmation — save the generated customer
  // confirmation and internal work-order PDFs for an order.
  app.post(
    '/api/orders/order-confirmation',
    requireFirebaseAuth,
    requireOfficeManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const orderKey = normalizeOptionalShortText(req.body?.orderKey, 260)
        const documentUrl = normalizeOptionalShortText(req.body?.documentUrl, 2000)
        const documentName = normalizeOptionalShortText(req.body?.documentName, 500)
        const workOrderUrl = normalizeOptionalShortText(req.body?.workOrderUrl, 2000)
        const workOrderName = normalizeOptionalShortText(req.body?.workOrderName, 500)
        const proformaInvoiceUrl = normalizeOptionalShortText(req.body?.proformaInvoiceUrl, 2000)
        const proformaInvoiceName = normalizeOptionalShortText(req.body?.proformaInvoiceName, 500)

        if (!orderKey || !documentUrl || !documentName || !workOrderUrl || !workOrderName || !proformaInvoiceUrl || !proformaInvoiceName) {
          return res.status(400).json({
            error: 'Order confirmation, work order, and proforma invoice documents are required.',
          })
        }

        let parsedDocumentUrl
        let parsedWorkOrderUrl
        let parsedProformaInvoiceUrl
        try {
          parsedDocumentUrl = new URL(documentUrl)
          parsedWorkOrderUrl = new URL(workOrderUrl)
          parsedProformaInvoiceUrl = new URL(proformaInvoiceUrl)
        } catch {
          return res.status(400).json({ error: 'Document URLs must be valid URLs.' })
        }

        if (parsedDocumentUrl.protocol !== 'https:' || parsedWorkOrderUrl.protocol !== 'https:' || parsedProformaInvoiceUrl.protocol !== 'https:') {
          return res.status(400).json({ error: 'Document URLs must use HTTPS.' })
        }

        const { ordersUnifiedCollection } = await getCollections()
        const now = new Date().toISOString()
        const result = await ordersUnifiedCollection.updateOne(
          {
            orderKey,
            is_cancelled: { $ne: true },
            is_deleted: { $ne: true },
          },
          {
            $set: {
              order_confirmation_url: documentUrl,
              order_confirmation_name: documentName,
              order_confirmation_generated_at: now,
              work_order_url: workOrderUrl,
              work_order_name: workOrderName,
              work_order_generated_at: now,
              proforma_invoice_url: proformaInvoiceUrl,
              proforma_invoice_name: proformaInvoiceName,
              proforma_invoice_generated_at: now,
              updatedAt: now,
            },
          },
        )

        if (result.matchedCount !== 1) {
          return res.status(404).json({ error: 'Order was not found.' })
        }

        return res.json({
          ok: true,
          orderConfirmationUrl: documentUrl,
          orderConfirmationName: documentName,
          workOrderUrl,
          workOrderName,
          proformaInvoiceUrl,
          proformaInvoiceName,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/delete — remove an order from website collections and
  // Monday (blocked when linked to QuickBooks).
  app.post(
    '/api/orders/delete',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const orderIdentityFilter = buildOrderIdentityFilter({
          orderKey: req.body?.orderKey,
          mondayItemId: req.body?.mondayItemId,
          orderNumber: req.body?.orderNumber,
        })

        if (!orderIdentityFilter) {
          return res.status(400).json({
            error: 'orderKey, mondayItemId, or orderNumber is required.',
          })
        }

        const {
          crmQuotesCollection,
          mondayOrdersCollection,
          orderProgressCollection,
          ordersUnifiedCollection,
        } = await getCollections()
        const orderDocument = await ordersUnifiedCollection.findOne(
          {
            $and: [
              orderIdentityFilter,
              { is_deleted: { $ne: true } },
            ],
          },
          {
            projection: {
              _id: 0,
              orderKey: 1,
              order_number: 1,
              order_name: 1,
              monday_item_id: 1,
              monday_board_id: 1,
              has_quickbooks_record: 1,
              qb_project_id: 1,
              qb_project_ids: 1,
              qb_project_names: 1,
              canonical_order_id: 1,
              source_quote_id: 1,
              selected_line_items: 1,
              selected_additional_services: 1,
              selected_shipping_services: 1,
              include_quote_freight: 1,
              deposit_request_url: 1,
              order_confirmation_url: 1,
              work_order_url: 1,
            },
          },
        )

        const fallbackMondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const mondayOnlyOrder = !orderDocument && fallbackMondayItemId
          ? await mondayOrdersCollection.findOne(
            { mondayItemId: fallbackMondayItemId },
            {
              projection: {
                _id: 0,
                mondayItemId: 1,
                jobNumber: 1,
                orderName: 1,
                mondayBoardId: 1,
              },
            },
          )
          : null

        if (!orderDocument && !mondayOnlyOrder) {
          return res.status(404).json({
            error: 'Order was not found.',
          })
        }

        const orderNumber = normalizeOrderNumberInput(
          orderDocument?.order_number ?? mondayOnlyOrder?.jobNumber ?? req.body?.orderNumber,
        ) || null
        const orderName = normalizeOptionalShortText(
          orderDocument?.order_name ?? mondayOnlyOrder?.orderName,
          260,
        ) || null
        const mondayItemId = String(
          orderDocument?.monday_item_id
          ?? mondayOnlyOrder?.mondayItemId
          ?? req.body?.mondayItemId
          ?? '',
        ).trim() || null
        const boardId = String(
          orderDocument?.monday_board_id
          ?? mondayOnlyOrder?.mondayBoardId
          ?? orderTrackBoardId,
        ).trim() || null
        const quickBooksProjectIds = [...new Set(
          [
            String(orderDocument?.qb_project_id ?? '').trim(),
            ...(Array.isArray(orderDocument?.qb_project_ids)
              ? orderDocument.qb_project_ids.map((value) => String(value ?? '').trim())
              : []),
          ].filter(Boolean),
        )]
        const hasQuickBooksRecord = Boolean(orderDocument?.has_quickbooks_record)
          || quickBooksProjectIds.length > 0

        if (hasQuickBooksRecord) {
          return res.status(409).json({
            error: 'This order is linked to QuickBooks and cannot be deleted directly. Request deletion from admin.',
            requiresAdminRequest: true,
            order: {
              orderKey: String(orderDocument?.orderKey ?? '').trim() || null,
              orderNumber,
              orderName,
              mondayItemId,
              quickBooksProjectIds,
            },
          })
        }

        const warnings = []
        let mondayDeleteResult = null

        if (mondayItemId) {
          mondayDeleteResult = await deleteMondayItem({
            itemId: mondayItemId,
            boardId,
          })
        }

        const generatedDocumentCleanup = orderDocument
          ? await deleteGeneratedOrderDocuments(orderDocument)
          : { attemptedCount: 0, deletedCount: 0, failedCount: 0 }
        if (generatedDocumentCleanup.failedCount > 0) {
          warnings.push(`Could not remove ${generatedDocumentCleanup.failedCount} generated order document${generatedDocumentCleanup.failedCount === 1 ? '' : 's'}.`)
        }

        const sourceQuoteId = String(orderDocument?.source_quote_id ?? '').trim()
        if (sourceQuoteId) {
          const quote = await crmQuotesCollection.findOne({ id: sourceQuoteId }, { projection: { _id: 0 } })
          if (quote) {
            const releasedKeys = new Set([
              ...(Array.isArray(orderDocument?.selected_line_items) ? orderDocument.selected_line_items : []).map((item) => `line:${String(item?.id ?? '').trim()}`).filter((key) => key !== 'line:'),
              ...(Array.isArray(orderDocument?.selected_additional_services) ? orderDocument.selected_additional_services : []).map((item) => `additional:${String(item?.id ?? '').trim()}`).filter((key) => key !== 'additional:'),
              ...(Array.isArray(orderDocument?.selected_shipping_services) ? orderDocument.selected_shipping_services : []).map((item) => `shipping:${String(item?.id ?? '').trim()}`).filter((key) => key !== 'shipping:'),
              ...(orderDocument?.include_quote_freight === true ? ['freight'] : []),
            ])
            const remainingKeys = (Array.isArray(quote.convertedItemKeys) ? quote.convertedItemKeys : [])
              .map((value) => String(value ?? '').trim())
              .filter((value) => value && !releasedKeys.has(value))
            const canonicalOrderId = String(orderDocument?.canonical_order_id ?? '').trim()
            const remainingOrders = (Array.isArray(quote.convertedOrders) ? quote.convertedOrders : [])
              .filter((entry) => String(entry?.orderId ?? '').trim() !== canonicalOrderId && String(entry?.orderNumber ?? '').trim().toLowerCase() !== String(orderNumber ?? '').trim().toLowerCase())
            const hasRemainingOrders = remainingKeys.length > 0 || remainingOrders.length > 0
            await crmQuotesCollection.updateOne(
              { id: sourceQuoteId },
              {
                $set: {
                  status: hasRemainingOrders ? 'sent' : 'draft',
                  opportunityStage: 'proposal_submission',
                  acceptedAt: null,
                  convertedItemKeys: remainingKeys,
                  convertedOrders: remainingOrders,
                  lastStatusChangedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
                $unset: {
                  convertedOrderId: '', convertedOrderNumber: '', convertedAt: '', orderNumber: '', acknowledgmentNumber: '',
                },
              },
            )
          }
        }

        const orderKey = String(orderDocument?.orderKey ?? '').trim() || ''
        const deletedOrderFilter = orderKey
          ? { orderKey }
          : mondayItemId
            ? { monday_item_id: mondayItemId }
            : {
              order_number: new RegExp(`^${escapeRegex(orderNumber)}$`, 'i'),
            }

        await Promise.all([
          mondayItemId
            ? mondayOrdersCollection.deleteOne({ mondayItemId })
            : Promise.resolve(),
          ordersUnifiedCollection.deleteMany(deletedOrderFilter),
          orderNumber
            ? orderProgressCollection.deleteMany({
              jobName: new RegExp(`^${escapeRegex(orderNumber)}$`, 'i'),
            })
            : Promise.resolve(),
        ])

        return res.json({
          ok: true,
          deleted: {
            orderKey: orderKey || null,
            orderNumber,
            orderName,
            mondayItemId,
            mondayDeleteMode: String(mondayDeleteResult?.mode ?? '').trim() || null,
            generatedDocumentCleanup,
          },
          warning: warnings.length > 0 ? warnings[0] : null,
          warnings,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/delete-request — create an admin/owner mobile alert for
  // deletion requests blocked by QuickBooks linkage rules.
  app.post(
    '/api/orders/delete-request',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const orderIdentityFilter = buildOrderIdentityFilter({
          orderKey: req.body?.orderKey,
          mondayItemId: req.body?.mondayItemId,
          orderNumber: req.body?.orderNumber,
        })
        const publicUser = toPublicAuthUser(req.authUser)

        if (!publicUser?.isApproved) {
          return res.status(403).json({
            error: 'Approved access is required.',
          })
        }

        if (!orderIdentityFilter) {
          return res.status(400).json({
            error: 'orderKey, mondayItemId, or orderNumber is required.',
          })
        }

        const {
          authUsersCollection,
          mobileAlertsCollection,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()
        const orderDocument = await ordersUnifiedCollection.findOne(
          orderIdentityFilter,
          {
            projection: {
              _id: 0,
              orderKey: 1,
              order_number: 1,
              order_name: 1,
              monday_item_id: 1,
              has_quickbooks_record: 1,
              qb_project_id: 1,
              qb_project_ids: 1,
              qb_project_names: 1,
            },
          },
        )
        const fallbackMondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const mondayOnlyOrder = !orderDocument && fallbackMondayItemId
          ? await mondayOrdersCollection.findOne(
            { mondayItemId: fallbackMondayItemId },
            {
              projection: {
                _id: 0,
                mondayItemId: 1,
                jobNumber: 1,
                orderName: 1,
              },
            },
          )
          : null

        if (!orderDocument && !mondayOnlyOrder) {
          return res.status(404).json({
            error: 'Order was not found.',
          })
        }

        const reason = normalizeOptionalShortText(req.body?.reason, 1200) || ''
        const orderPayload = {
          orderKey: String(orderDocument?.orderKey ?? '').trim() || null,
          orderNumber:
            normalizeOrderNumberInput(orderDocument?.order_number)
            || normalizeOrderNumberInput(mondayOnlyOrder?.jobNumber)
            || normalizeOrderNumberInput(req.body?.orderNumber)
            || null,
          orderName:
            normalizeOptionalShortText(orderDocument?.order_name, 260)
            || normalizeOptionalShortText(mondayOnlyOrder?.orderName, 260)
            || null,
          mondayItemId:
            String(orderDocument?.monday_item_id ?? '').trim()
            || String(mondayOnlyOrder?.mondayItemId ?? '').trim()
            || String(req.body?.mondayItemId ?? '').trim()
            || null,
          hasQuickBooksRecord: Boolean(orderDocument?.has_quickbooks_record),
          quickBooksProjectIds: [...new Set([
            String(orderDocument?.qb_project_id ?? '').trim(),
            ...(Array.isArray(orderDocument?.qb_project_ids)
              ? orderDocument.qb_project_ids.map((value) => String(value ?? '').trim())
              : []),
          ].filter(Boolean))],
          quickBooksProjectNames: [...new Set(
            Array.isArray(orderDocument?.qb_project_names)
              ? orderDocument.qb_project_names.map((value) => String(value ?? '').trim()).filter(Boolean)
              : [],
          )],
        }

        const alertDocument = await createOrderDeleteRequestAdminAlert({
          authUsersCollection,
          mobileAlertsCollection,
          publicUser,
          order: orderPayload,
          reason,
        })

        return res.status(201).json({
          ok: true,
          alert: toPublicMobileAlert(alertDocument),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/ship — move an order from Order Track to Shipped in
  // Monday after required website shipping docs are uploaded.
  app.post(
    '/api/orders/ship',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const orderIdentityFilter = buildOrderIdentityFilter({
          orderKey: req.body?.orderKey,
          mondayItemId: req.body?.mondayItemId,
          orderNumber: req.body?.orderNumber,
        })

        if (!orderIdentityFilter) {
          return res.status(400).json({
            error: 'orderKey, mondayItemId, or orderNumber is required.',
          })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()
        const orderDocument = await ordersUnifiedCollection.findOne(
          orderIdentityFilter,
          {
            projection: {
              _id: 0,
              orderKey: 1,
              order_number: 1,
              order_name: 1,
              monday_item_id: 1,
              monday_board_id: 1,
              monday_board_name: 1,
              Monday_url: 1,
              is_shipped: 1,
              signed_bol: 1,
              Signed_BOL_source: 1,
              Signed_BOL: 1,
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
            },
          },
        )

        if (!orderDocument) {
          return res.status(404).json({ error: 'Order was not found.' })
        }

        const mondayItemId = String(orderDocument?.monday_item_id ?? '').trim()

        if (!mondayItemId) {
          return res.status(409).json({
            error: 'This order is not linked to a Monday item, so it cannot be shipped from the website.',
          })
        }

        const signedBolValue = String(orderDocument?.signed_bol ?? '').trim()
        const signedBolUrl =
          String(orderDocument?.Signed_BOL_source ?? '').trim()
          || String(orderDocument?.Signed_BOL ?? '').trim()
          || null
        const inspectionSheetValue = String(orderDocument?.inspection_sheet ?? '').trim()
        const inspectionSheetUrl =
          String(orderDocument?.Inspection_sheet_source ?? '').trim()
          || String(orderDocument?.Inspection_sheet ?? '').trim()
          || null

        if (!signedBolValue && !signedBolUrl) {
          return res.status(409).json({
            error: 'Driver Signed BOL must be uploaded before shipping.',
          })
        }

        if (!inspectionSheetValue && !inspectionSheetUrl) {
          return res.status(409).json({
            error: 'Inspection Sheet must be uploaded before shipping.',
          })
        }

        if (Boolean(orderDocument?.is_shipped)) {
          return res.status(409).json({
            error: 'Order is already shipped. You can still upload shipping documents.',
          })
        }

        const sourceBoardId = String(orderDocument?.monday_board_id ?? '').trim()
        const targetBoardId = String(process.env.MONDAY_SHIPPED_BOARD_ID ?? '').trim()
        const targetBoardUrl = String(process.env.MONDAY_SHIPPED_BOARD_URL ?? '').trim() || null

        if (!sourceBoardId) {
          return res.status(409).json({
            error: 'Could not resolve source Monday board for this order.',
          })
        }

        if (!targetBoardId) {
          return res.status(500).json({
            error: 'MONDAY_SHIPPED_BOARD_ID is not configured.',
          })
        }

        const moveResult = await moveMondayItemToBoard({
          sourceBoardId,
          targetBoardId,
          itemId: mondayItemId,
        })
        const movedSnapshot = await fetchMondayBoardItemsByIds({
          boardId: targetBoardId,
          boardName: moveResult?.targetBoardName,
          boardUrl: targetBoardUrl,
          itemIds: [mondayItemId],
        })
        const movedOrder = Array.isArray(movedSnapshot?.orders)
          ? movedSnapshot.orders[0]
          : null
        const now = new Date().toISOString()
        const mondayUpdatedAt = String(movedOrder?.updatedAt ?? '').trim() || now
        const mondayStatus = String(movedOrder?.statusLabel ?? '').trim() || 'Shipped'
        const shippedAt = String(movedOrder?.shippedAt ?? '').trim() || now
        const progressStatusDetails = normalizeProgressStatusDetails(movedOrder?.progressStatusDetails)
        const publicUser = toPublicAuthUser(req.authUser)
        const updateFilter = buildOrderIdentityFilter({
          orderKey: orderDocument?.orderKey,
          mondayItemId,
          orderNumber: orderDocument?.order_number,
        })

        if (!updateFilter) {
          return res.status(409).json({
            error: 'Could not resolve order identity for shipping update.',
          })
        }

        await Promise.all([
          mondayOrdersCollection.updateOne(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                mondayBoardId: targetBoardId,
                mondayBoardName: moveResult?.targetBoardName || String(orderDocument?.monday_board_name ?? '').trim() || null,
                mondayBoardUrl: targetBoardUrl,
                orderName: String(movedOrder?.name ?? '').trim() || String(orderDocument?.order_name ?? '').trim() || null,
                jobNumber: String(movedOrder?.jobNumber ?? '').trim() || String(orderDocument?.order_number ?? '').trim() || null,
                statusLabel: 'Shipped',
                stageLabel: String(movedOrder?.stageLabel ?? '').trim() || null,
                readyLabel: String(movedOrder?.readyLabel ?? '').trim() || null,
                progressStatusDetails,
                progressPercent: Number.isFinite(Number(movedOrder?.progressPercent))
                  ? Number(movedOrder.progressPercent)
                  : null,
                orderDate: String(movedOrder?.orderDate ?? '').trim() || null,
                dueDate: String(movedOrder?.dueDate ?? '').trim() || null,
                computedDueDate: String(movedOrder?.computedDueDate ?? '').trim() || null,
                effectiveDueDate: String(movedOrder?.effectiveDueDate ?? '').trim() || null,
                leadTimeDays: Number.isFinite(Number(movedOrder?.leadTimeDays))
                  ? Number(movedOrder.leadTimeDays)
                  : null,
                shippedAt,
                movedToShippedAt: now,
                isDone: true,
                isLate: Boolean(movedOrder?.isLate),
                daysLate: Number.isFinite(Number(movedOrder?.daysLate))
                  ? Number(movedOrder.daysLate)
                  : 0,
                mondayItemUrl: String(movedOrder?.itemUrl ?? '').trim() || String(orderDocument?.Monday_url ?? '').trim() || null,
                mondayUpdatedAt,
                updatedAt: now,
                lastSeenAt: now,
              },
              $setOnInsert: {
                createdAt: now,
              },
            },
            { upsert: true },
          ),
          ordersUnifiedCollection.updateOne(
            updateFilter,
            {
              $set: {
                has_monday_record: true,
                monday_item_id: mondayItemId,
                monday_board_id: targetBoardId,
                monday_board_name: moveResult?.targetBoardName || String(orderDocument?.monday_board_name ?? '').trim() || 'Shipped Orders',
                Monday_url: String(movedOrder?.itemUrl ?? '').trim() || String(orderDocument?.Monday_url ?? '').trim() || null,
                Monday_status: 'Shipped',
                is_shipped: true,
                customer_signed_bol_required: true,
                shipped_at: shippedAt,
                shipped_at_inferred: String(movedOrder?.shippedAt ?? '').trim() ? false : true,
                Due_date: String(movedOrder?.dueDate ?? '').trim() || null,
                Lead_time_days: Number.isFinite(Number(movedOrder?.leadTimeDays))
                  ? Number(movedOrder.leadTimeDays)
                  : null,
                progress_percent: Number.isFinite(Number(movedOrder?.progressPercent))
                  ? Number(movedOrder.progressPercent)
                  : null,
                progress_status_details: progressStatusDetails,
                order_date: String(movedOrder?.orderDate ?? '').trim() || null,
                monday_updated_at: mondayUpdatedAt,
                moved_to_shipped_via_website_at: now,
                moved_to_shipped_via_website_by_uid: String(publicUser?.uid ?? '').trim() || null,
                moved_to_shipped_via_website_by_email: normalizeEmail(publicUser?.email) || null,
                monday_ship_mapping_mode: String(moveResult?.mappingMode ?? '').trim() || null,
                updatedAt: now,
                lastSyncedAt: now,
              },
            },
          ),
        ])

        return res.json({
          ok: true,
          move: {
            itemId: mondayItemId,
            sourceBoardId: moveResult?.sourceBoardId || sourceBoardId,
            sourceBoardName: moveResult?.sourceBoardName || null,
            targetBoardId: moveResult?.targetBoardId || targetBoardId,
            targetBoardName: moveResult?.targetBoardName || null,
            targetGroupId: moveResult?.targetGroupId || null,
            targetGroupTitle: moveResult?.targetGroupTitle || null,
            mappingMode: moveResult?.mappingMode || 'explicit',
            mappedColumnCount: Number(moveResult?.mappedColumnCount) || 0,
            totalSourceColumnCount: Number(moveResult?.totalSourceColumnCount) || 0,
          },
          order: {
            orderKey: String(orderDocument?.orderKey ?? '').trim() || null,
            mondayItemId,
            orderNumber: String(orderDocument?.order_number ?? '').trim() || null,
            isShipped: true,
            shippedAt,
            mondayStatus,
            mondayBoardId: targetBoardId,
            mondayBoardName: moveResult?.targetBoardName || null,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/suborder-link — link an order to a main order (or clear
  // the link with parentOrderNumber: null). The sub-order stays a fully
  // separate order everywhere; only the money/labor rollup combines.
  app.post(
    '/api/orders/suborder-link',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const requestedOrderKey = String(req.body?.orderKey ?? '').trim()
        const requestedMondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const requestedOrderNumber = String(req.body?.orderNumber ?? '').trim()

        if (!requestedOrderKey && !requestedMondayItemId && !requestedOrderNumber) {
          return res.status(400).json({
            error: 'orderKey, mondayItemId, or orderNumber is required.',
          })
        }

        const hasParentField = Boolean(
          req.body
          && Object.prototype.hasOwnProperty.call(req.body, 'parentOrderNumber'),
        )

        if (!hasParentField) {
          return res.status(400).json({
            error: 'parentOrderNumber is required (null clears the link).',
          })
        }

        const requestedParentOrderNumber = String(req.body?.parentOrderNumber ?? '').trim()
        const { ordersUnifiedCollection } = await getCollections()
        const projection = {
          _id: 0,
          orderKey: 1,
          order_number: 1,
          parent_order_number: 1,
        }

        // Order number variants can legitimately share a Monday item during
        // claim/rework setup (for example 250610 and 250610R). Resolve the
        // immutable order key first instead of using an ambiguous $or query.
        let orderDocument = requestedOrderKey
          ? await ordersUnifiedCollection.findOne({ orderKey: requestedOrderKey }, { projection })
          : null

        if (!orderDocument && requestedOrderNumber) {
          orderDocument = await ordersUnifiedCollection.findOne(
            { order_number: new RegExp(`^${escapeRegex(requestedOrderNumber)}$`, 'i') },
            { projection },
          )
        }

        if (!orderDocument && requestedMondayItemId) {
          orderDocument = await ordersUnifiedCollection.findOne(
            { monday_item_id: requestedMondayItemId },
            { projection },
          )
        }

        if (!orderDocument) {
          return res.status(404).json({ error: 'Order was not found.' })
        }

        const orderNumber = String(orderDocument?.order_number ?? '').trim()

        if (requestedParentOrderNumber) {
          if (
            orderNumber
            && requestedParentOrderNumber.toLowerCase() === orderNumber.toLowerCase()
          ) {
            return res.status(400).json({
              error: 'An order cannot be its own main order.',
            })
          }

          const parentDocument = await ordersUnifiedCollection.findOne(
            {
              order_number: new RegExp(
                `^${requestedParentOrderNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
                'i',
              ),
            },
            {
              projection: {
                _id: 0,
                order_number: 1,
                parent_order_number: 1,
              },
            },
          )

          if (!parentDocument) {
            return res.status(404).json({
              error: `Main order ${requestedParentOrderNumber} was not found.`,
            })
          }

          if (String(parentDocument?.parent_order_number ?? '').trim()) {
            return res.status(409).json({
              error: 'The main order is itself a sub-order. Link to the top-level order instead.',
            })
          }

          if (orderNumber) {
            const childOfThisOrder = await ordersUnifiedCollection.findOne(
              { parent_order_number: new RegExp(`^${orderNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
              { projection: { _id: 0, order_number: 1 } },
            )

            if (childOfThisOrder) {
              return res.status(409).json({
                error: 'This order already has sub-orders, so it cannot become a sub-order itself.',
              })
            }
          }
        }

        const now = new Date().toISOString()
        const resolvedParentOrderNumber = requestedParentOrderNumber || null

        const resolvedOrderKey = String(orderDocument?.orderKey ?? '').trim()
        const resolvedOrderFilter = resolvedOrderKey
          ? { orderKey: resolvedOrderKey }
          : { order_number: new RegExp(`^${escapeRegex(orderNumber)}$`, 'i') }

        await ordersUnifiedCollection.updateOne(
          resolvedOrderFilter,
          {
            $set: {
              parent_order_number: resolvedParentOrderNumber,
              updatedAt: now,
            },
          },
        )

        return res.json({
          ok: true,
          orderNumber: orderNumber || null,
          parentOrderNumber: resolvedParentOrderNumber,
        })
      } catch (error) {
        next(error)
      }
    },
  )

}
