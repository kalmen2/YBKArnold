// Order document endpoints: shop drawings and cut lists (with Monday
// write-through), and the website-owned shipping documents (signed BOL,
// inspection sheet) stored in Firebase Storage — never in Monday.

import { randomUUID } from 'node:crypto'
import {
  buildFirebaseStorageDownloadUrl,
  normalizeOptionalShortText,
} from '../utils/value-utils.mjs'
import {
  buildOrderIdentityFilter,
  ensurePdfFileName,
  sanitizeDownloadFileName,
  sanitizeStorageSegment,
} from './order-shared.mjs'

import { createMondayCardStore } from './monday-card-store.mjs'

export function registerOrderDocumentRoutes(app, {
  assertMondayLink,
  clearMondayColumnValue,
  decodeBase64Image,
  fetchMondayBoardItemsByIds,
  getCollections,
  getOrderPhotosBucket,
  pullLiveMondayProgressDetails,
  refreshOrdersUnifiedCollection,
  requireFirebaseAuth,
  resolveMondayOrderContext,
  syncMondayProgressDetailsToCollections,
  toPublicAuthUser,
  updateMondayLinkColumnValue,
}) {
  const mondayCards = createMondayCardStore({ getCollections })

  const shippingDocumentMimeTypes = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
  ])
  function normalizeShippingDocumentType(value) {
    const normalized = String(value ?? '').trim().toLowerCase()

    if (normalized === 'signed_bol' || normalized === 'signed-bol') {
      return 'signed_bol'
    }

    if (normalized === 'customer_signed_bol' || normalized === 'customer-signed-bol') {
      return 'customer_signed_bol'
    }

    if (
      normalized === 'customer_signed_change_order'
      || normalized === 'customer-signed-change-order'
    ) {
      return 'customer_signed_change_order'
    }

    if (normalized === 'inspection_sheet' || normalized === 'inspection-sheet') {
      return 'inspection_sheet'
    }

    // Both spellings are in use across the codebase; accept either.
    if (
      normalized === 'acknowledgment'
      || normalized === 'acknowledgement'
      || normalized === 'acknowledgment_document'
      || normalized === 'acknowledgement_document'
    ) {
      return 'acknowledgment'
    }

    return ''
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

  function extensionForShippingDocumentMimeType(mimeType) {
    const normalized = String(mimeType ?? '').trim().toLowerCase()

    switch (normalized) {
      case 'image/jpeg':
        return 'jpg'
      case 'image/png':
        return 'png'
      case 'image/webp':
        return 'webp'
      case 'image/heic':
        return 'heic'
      case 'image/heif':
        return 'heif'
      default:
        return 'pdf'
    }
  }

  function ensureShippingDocumentFileName(fileName, mimeType, fallbackBaseName) {
    const safeName = sanitizeDownloadFileName(fileName, fallbackBaseName)

    if (/\.[a-zA-Z0-9]{2,8}$/.test(safeName)) {
      return safeName
    }

    return `${safeName}.${extensionForShippingDocumentMimeType(mimeType)}`
  }

  function normalizeCutListDocuments(value) {
    if (!Array.isArray(value)) {
      return []
    }

    const seenUrls = new Set()

    return value
      .map((document) => {
        const url = normalizeOptionalShortText(document?.url, 1200)

        if (!url || seenUrls.has(url)) {
          return null
        }

        seenUrls.add(url)

        return {
          fileName: normalizeOptionalShortText(document?.fileName, 260) || 'cut-list.pdf',
          mimeType: normalizeOptionalShortText(document?.mimeType, 120) || 'application/pdf',
          url,
          uploadedAt: normalizeOptionalShortText(document?.uploadedAt, 120) || null,
          storagePath: normalizeOptionalShortText(document?.storagePath, 800) || null,
        }
      })
      .filter(Boolean)
  }

  function resolveShippingDocumentFieldNames(documentType) {
    if (documentType === 'signed_bol') {
      return {
        documentLabel: 'Driver Signed BOL',
        storageFolder: 'signed-bol',
        fileNameField: 'signed_bol',
        urlFieldPrimary: 'Signed_BOL_source',
        urlFieldLegacy: 'Signed_BOL',
        uploadedAtField: 'signed_bol_uploaded_at',
        storagePathField: 'signed_bol_storage_path',
        mimeTypeField: 'signed_bol_mime_type',
      }
    }

    if (documentType === 'customer_signed_bol') {
      return {
        documentLabel: 'Customer Signed BOL',
        storageFolder: 'customer-signed-bol',
        fileNameField: 'customer_signed_bol',
        urlFieldPrimary: 'Customer_Signed_BOL_source',
        urlFieldLegacy: 'Customer_Signed_BOL',
        uploadedAtField: 'customer_signed_bol_uploaded_at',
        storagePathField: 'customer_signed_bol_storage_path',
        mimeTypeField: 'customer_signed_bol_mime_type',
      }
    }

    if (documentType === 'customer_signed_change_order') {
      return {
        documentLabel: 'Customer Signed Change Order',
        storageFolder: 'customer-signed-change-order',
        fileNameField: 'customer_signed_change_order',
        urlFieldPrimary: 'customer_signed_change_order_url',
        urlFieldLegacy: 'Customer_Signed_Change_Order',
        uploadedAtField: 'customer_signed_change_order_uploaded_at',
        storagePathField: 'customer_signed_change_order_storage_path',
        mimeTypeField: 'customer_signed_change_order_mime_type',
      }
    }

    if (documentType === 'acknowledgment') {
      return {
        documentLabel: 'Acknowledgment',
        storageFolder: 'acknowledgment',
        fileNameField: 'acknowledgment_document',
        urlFieldPrimary: 'Acknowledgment_source',
        urlFieldLegacy: 'Acknowledgment',
        uploadedAtField: 'acknowledgment_uploaded_at',
        storagePathField: 'acknowledgment_storage_path',
        mimeTypeField: 'acknowledgment_mime_type',
      }
    }

    return {
      documentLabel: 'Inspection Sheet',
      storageFolder: 'inspection-sheet',
      fileNameField: 'inspection_sheet',
      urlFieldPrimary: 'Inspection_sheet_source',
      urlFieldLegacy: 'Inspection_sheet',
      uploadedAtField: 'inspection_sheet_uploaded_at',
      storagePathField: 'inspection_sheet_storage_path',
      mimeTypeField: 'inspection_sheet_mime_type',
    }
  }

  function normalizeOrderChangeLines(value) {
    if (!Array.isArray(value)) return []

    return value.slice(0, 250).map((line, index) => {
      const parentLineId = normalizeOptionalShortText(line?.parentLineId, 160) || null
      const category = line?.category === 'freight'
        ? 'freight'
        : line?.category === 'additional'
          ? 'additional'
          : 'product'
      const qty = Number(line?.qty)
      const unitPrice = Number(line?.unitPrice)
      const extPriceInput = Number(line?.extPrice)
      const normalizedQty = Number.isFinite(qty) && qty >= 0 ? qty : 0
      const normalizedUnitPrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0
      const extPrice = Number.isFinite(extPriceInput) && extPriceInput >= 0
        ? extPriceInput
        : normalizedQty * normalizedUnitPrice

      return {
        id: normalizeOptionalShortText(line?.id, 160) || randomUUID(),
        parentLineId,
        detailLabel: normalizeOptionalShortText(line?.detailLabel, 240) || null,
        description: parentLineId
          ? normalizeOptionalShortText(line?.description, 1000) || ''
          : normalizeOptionalShortText(line?.description, 1000) || `Item ${index + 1}`,
        qty: parentLineId ? 0 : normalizedQty,
        unitPrice: parentLineId ? 0 : normalizedUnitPrice,
        extPrice: parentLineId ? 0 : Number(extPrice.toFixed(2)),
        category,
      }
    })
  }

  function buildSnapshotFromOrderLines(currentSnapshot, lines) {
    const productLines = lines.filter((line) => line.category === 'product')
    const additionalLines = lines.filter((line) => line.category === 'additional')
    const freightLines = lines.filter((line) => line.category === 'freight')
    const productNet = Number(
      [...productLines, ...additionalLines]
        .reduce((sum, line) => sum + Number(line.extPrice || 0), 0)
        .toFixed(2),
    )
    const freightNet = Number(
      freightLines
        .reduce((sum, line) => sum + Number(line.extPrice || 0), 0)
        .toFixed(2),
    )

    return {
      snapshot: {
        ...(currentSnapshot && typeof currentSnapshot === 'object' ? currentSnapshot : {}),
        lineItems: productLines,
        additionalServices: additionalLines,
        shippingServices: freightLines,
        productTotal: productNet,
        freight: freightNet,
        totalAmount: productNet + freightNet,
      },
      productNet,
      freightNet,
    }
  }

  // POST /api/orders/document-lines — replace the active order line details
  // used by generated order confirmations, work orders, invoices, and BOLs.
  app.post(
    '/api/orders/document-lines',
    requireFirebaseAuth,
    requireOfficeManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const orderIdentityFilter = buildOrderIdentityFilter({
          orderKey: req.body?.orderKey,
          mondayItemId: req.body?.mondayItemId,
          orderNumber: req.body?.orderNumber,
        })
        const lines = normalizeOrderChangeLines(req.body?.lines)

        if (!orderIdentityFilter) {
          return res.status(400).json({ error: 'Order identity is required.' })
        }
        if (lines.length === 0) {
          return res.status(400).json({ error: 'At least one order line is required.' })
        }

        const { ordersUnifiedCollection } = await getCollections()
        const orderDocument = await ordersUnifiedCollection.findOne(
          orderIdentityFilter,
          {
            projection: {
              _id: 0,
              source_quote_snapshot: 1,
            },
          },
        )

        if (!orderDocument) {
          return res.status(404).json({ error: 'Order was not found.' })
        }

        const { snapshot, productNet, freightNet } = buildSnapshotFromOrderLines(
          orderDocument.source_quote_snapshot,
          lines,
        )
        const now = new Date().toISOString()

        await ordersUnifiedCollection.updateOne(
          orderIdentityFilter,
          {
            $set: {
              source_quote_snapshot: snapshot,
              canonical_product_value: productNet,
              canonical_order_value: productNet + freightNet,
              canonical_freight_value: freightNet,
              orderValue: productNet + freightNet,
              freightValue: freightNet,
              website_calculated_order_total: productNet + freightNet,
              website_calculated_order_total_at: now,
              updatedAt: now,
              lastSyncedAt: now,
            },
          },
        )

        return res.json({
          ok: true,
          productNet,
          freightNet,
          grandTotal: productNet + freightNet,
          lines,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/change-orders — stage revised order lines and their
  // generated Change Order PDF without changing the active order.
  app.post(
    '/api/orders/change-orders',
    requireFirebaseAuth,
    requireOfficeManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const orderIdentityFilter = buildOrderIdentityFilter({
          orderKey: req.body?.orderKey,
          mondayItemId: req.body?.mondayItemId,
          orderNumber: req.body?.orderNumber,
        })
        const lines = normalizeOrderChangeLines(req.body?.lines)
        const changeOrderUrl = normalizeOptionalShortText(req.body?.changeOrderUrl, 2000)
        const changeOrderName = normalizeOptionalShortText(req.body?.changeOrderName, 500)

        if (!orderIdentityFilter) {
          return res.status(400).json({ error: 'Order identity is required.' })
        }
        if (lines.length === 0) {
          return res.status(400).json({ error: 'At least one order line is required.' })
        }
        if (!changeOrderUrl || !changeOrderName) {
          return res.status(400).json({ error: 'The generated Change Order document is required.' })
        }

        try {
          const parsedUrl = new URL(changeOrderUrl)
          if (parsedUrl.protocol !== 'https:') throw new Error('HTTPS required')
        } catch {
          return res.status(400).json({ error: 'Change Order URL must be a valid HTTPS URL.' })
        }

        const { ordersUnifiedCollection } = await getCollections()
        const orderDocument = await ordersUnifiedCollection.findOne(
          orderIdentityFilter,
          {
            projection: {
              _id: 0,
              orderKey: 1,
              order_number: 1,
              source_quote_snapshot: 1,
              change_version: 1,
              pending_order_change: 1,
            },
          },
        )

        if (!orderDocument) {
          return res.status(404).json({ error: 'Order was not found.' })
        }

        const existingPendingVersion = Number(orderDocument?.pending_order_change?.version)
        const currentVersion = Number.isFinite(Number(orderDocument?.change_version))
          ? Math.max(0, Number(orderDocument.change_version))
          : 0
        const version = Number.isFinite(existingPendingVersion) && existingPendingVersion > currentVersion
          ? existingPendingVersion
          : currentVersion + 1
        const productLines = lines.filter((line) => line.category !== 'freight')
        const freightLines = lines.filter((line) => line.category === 'freight')
        const productNet = Number(productLines.reduce((sum, line) => sum + line.extPrice, 0).toFixed(2))
        const freightNet = Number(freightLines.reduce((sum, line) => sum + line.extPrice, 0).toFixed(2))
        const now = new Date().toISOString()
        const currentSnapshot = orderDocument?.source_quote_snapshot
          && typeof orderDocument.source_quote_snapshot === 'object'
          ? orderDocument.source_quote_snapshot
          : {}
        const revisedSnapshot = {
          ...currentSnapshot,
          lineItems: productLines.filter((line) => line.category === 'product'),
          additionalServices: productLines.filter((line) => line.category === 'additional'),
          shippingServices: freightLines,
          productTotal: productNet,
          freight: freightNet,
          totalAmount: productNet + freightNet,
        }
        const pendingOrderChange = {
          version,
          status: 'awaiting_customer_signature',
          lines,
          productNet,
          freightNet,
          grandTotal: productNet + freightNet,
          revisedSnapshot,
          changeOrderUrl,
          changeOrderName,
          createdAt: now,
          createdByUid: String(req.authUser?.uid ?? '').trim() || null,
          createdByEmail: String(req.authUser?.email ?? '').trim() || null,
        }

        await ordersUnifiedCollection.updateOne(
          orderIdentityFilter,
          {
            $set: {
              pending_order_change: pendingOrderChange,
              change_order_url: changeOrderUrl,
              change_order_name: changeOrderName,
              change_order_status: 'awaiting_customer_signature',
              customer_signed_change_order: null,
              customer_signed_change_order_url: null,
              Customer_Signed_Change_Order: null,
              customer_signed_change_order_uploaded_at: null,
              work_order_url: null,
              work_order_name: null,
              work_order_generated_at: null,
              updatedAt: now,
            },
          },
        )

        return res.status(201).json({
          ok: true,
          version,
          status: 'awaiting_customer_signature',
          changeOrderUrl,
          changeOrderName,
          productNet,
          freightNet,
          grandTotal: productNet + freightNet,
          lines,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/shop-drawing/upload — office/manager/admin replace flow
  // for shop drawings with Monday write-through.
  app.post(
    '/api/orders/monday/shop-drawing/upload',
    requireFirebaseAuth,
    requireOfficeManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const mimeType = String(req.body?.mimeType ?? 'application/pdf')
          .trim()
          .toLowerCase()
        const requestedFileName = String(req.body?.fileName ?? '').trim()
        const base64Payload = req.body?.fileBase64
          ?? req.body?.fileData
          ?? req.body?.data
          ?? null

        if (!mondayItemId) {
          return res.status(400).json({ error: 'mondayItemId is required.' })
        }

        if (!requestedFileName) {
          return res.status(400).json({ error: 'fileName is required.' })
        }

        if (!shippingDocumentMimeTypes.has(mimeType)) {
          return res.status(400).json({ error: 'Unsupported document mimeType.' })
        }

        const fileBuffer = decodeBase64Image(base64Payload)

        if (!fileBuffer || fileBuffer.length <= 0) {
          return res.status(400).json({ error: 'fileBase64 is required.' })
        }

        if (fileBuffer.length > 10 * 1024 * 1024) {
          return res.status(400).json({ error: 'File exceeds 10MB limit.' })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        // Confirm the stored id still belongs to this order number before
        // attaching a document link to it.
        const documentLink = await assertMondayLink({
          orderNumber: context.orderNumber,
          storedItemId: mondayItemId,
        })

        const snapshot = await fetchMondayBoardItemsByIds({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          itemIds: [mondayItemId],
        })
        const liveOrder = Array.isArray(snapshot?.orders)
          ? snapshot.orders[0]
          : null

        if (!liveOrder) {
          return res.status(404).json({
            error: 'Monday item was not found on the configured board.',
          })
        }

        const shopDrawingColumnId = String(snapshot?.columnDetection?.shopDrawingColumnId ?? '').trim()

        if (!shopDrawingColumnId) {
          return res.status(409).json({
            error: 'Shop drawing column could not be resolved for this board.',
          })
        }

        const bucket = typeof getOrderPhotosBucket === 'function'
          ? getOrderPhotosBucket()
          : null

        if (!bucket) {
          throw Object.assign(new Error('Order photo storage bucket is unavailable.'), { status: 500 })
        }

        const orderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              order_number: 1,
              order_name: 1,
              Cut_list_cached: 1,
              Cut_list_source: 1,
              cut_list_documents: 1,
            },
          },
        )

        const storageOrderId = sanitizeStorageSegment(
          orderDocument?.order_number || mondayItemId,
          'order',
        )
        const storedFileName = ensureShippingDocumentFileName(
          requestedFileName,
          mimeType,
          `${storageOrderId}-shop-drawing.pdf`,
        )
        const storagePath = `orders-shop-drawings/${storageOrderId}/${Date.now()}-${storedFileName}`
        const downloadToken = typeof randomUUID === 'function'
          ? randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
        const now = new Date().toISOString()

        await bucket.file(storagePath).save(fileBuffer, {
          resumable: false,
          metadata: {
            contentType: mimeType,
            metadata: {
              firebaseStorageDownloadTokens: downloadToken,
              mondayItemId,
              orderNumber: String(orderDocument?.order_number ?? '').trim() || null,
              uploadedAt: now,
            },
          },
        })

        const downloadUrl = buildFirebaseStorageDownloadUrl(bucket.name, storagePath, downloadToken)
        const existingCutListDocuments = normalizeCutListDocuments(orderDocument?.cut_list_documents)
        const currentLegacyUrl =
          normalizeOptionalShortText(orderDocument?.Cut_list_cached, 1200)
          || normalizeOptionalShortText(orderDocument?.Cut_list_source, 1200)
          || null

        if (
          currentLegacyUrl
          && !existingCutListDocuments.some((document) => document.url === currentLegacyUrl)
        ) {
          existingCutListDocuments.push({
            fileName: 'cut-list.pdf',
            mimeType: 'application/pdf',
            url: currentLegacyUrl,
            uploadedAt: null,
            storagePath: null,
          })
        }

        const nextCutListDocuments = [
          ...existingCutListDocuments,
          {
            fileName: storedFileName,
            mimeType,
            url: downloadUrl,
            uploadedAt: now,
            storagePath,
          },
        ]

        await updateMondayLinkColumnValue({
          boardId: documentLink.boardId,
          itemId: documentLink.itemId,
          columnId: shopDrawingColumnId,
          urlValue: downloadUrl,
          linkText: storedFileName,
        })

        const {
          liveOrder: refreshedLiveOrder,
          resolvedBoardName,
          resolvedBoardUrl,
          progressStatusDetails,
        } = await pullLiveMondayProgressDetails({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          mondayItemId,
        })

        const syncResult = await syncMondayProgressDetailsToCollections({
          mondayItemId,
          boardId: context.boardId,
          boardName: resolvedBoardName,
          boardUrl: resolvedBoardUrl,
          liveOrder: refreshedLiveOrder,
          progressStatusDetails,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        const refreshedShopDrawingUrl =
          normalizeOptionalShortText(refreshedLiveOrder?.shopDrawingUrl, 800)
          || downloadUrl

        await Promise.all([
          mondayCards.updateOneCompat(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                shopDrawingStoragePath: storagePath,
                shopDrawingDownloadUrl: downloadUrl,
                shopDrawingContentType: mimeType,
                shopDrawingCachedAt: now,
                shopDrawingCacheStatus: 'ready',
                shopDrawingCacheError: null,
                shopDrawingFileName: storedFileName,
                shopDrawingSourceAssetId: null,
                shopDrawingSourceUrl: null,
                shopDrawingResolvedUrl: null,
                shopDrawingUrl: null,
                mondayUpdatedAt: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSeenAt: now,
              },
            },
            { upsert: true },
          ),
          ordersUnifiedCollection.updateOne(
            { monday_item_id: mondayItemId },
            {
              $set: {
                has_monday_record: true,
                monday_item_id: mondayItemId,
                monday_board_id: context.boardId,
                monday_board_name: resolvedBoardName,
                Shop_drawing_cached: downloadUrl,
                Shop_drawing_source: refreshedShopDrawingUrl,
                Shop_drawing: downloadUrl,
                monday_updated_at: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSyncedAt: now,
              },
            },
            { upsert: true },
          ),
        ])

        let refreshWarning = null

        try {
          await refreshOrdersUnifiedCollection()
        } catch (refreshError) {
          refreshWarning = refreshError instanceof Error
            ? refreshError.message
            : 'Shop drawing saved to Monday, but unified refresh failed.'
        }

        const updatedOrderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              order_number: 1,
              Shop_drawing_cached: 1,
              Shop_drawing_source: 1,
              monday_updated_at: 1,
            },
          },
        )

        return res.status(201).json({
          ok: true,
          document: {
            fileName: storedFileName,
            mimeType,
            url: downloadUrl,
            uploadedAt: now,
          },
          order: {
            mondayItemId,
            orderNumber: String(updatedOrderDocument?.order_number ?? '').trim() || null,
            shopDrawingCachedUrl:
              String(updatedOrderDocument?.Shop_drawing_cached ?? '').trim()
              || downloadUrl,
            shopDrawingUrl:
              String(updatedOrderDocument?.Shop_drawing_source ?? '').trim()
              || refreshedShopDrawingUrl
              || null,
            mondayUpdatedAt:
              String(updatedOrderDocument?.monday_updated_at ?? '').trim()
              || syncResult.mondayUpdatedAt,
          },
          warning: refreshWarning,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/shop-drawing/delete — office/manager/admin clear flow
  // for shop drawings with Monday write-through.
  app.post(
    '/api/orders/monday/shop-drawing/delete',
    requireFirebaseAuth,
    requireOfficeManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.body?.mondayItemId ?? '').trim()

        if (!mondayItemId) {
          return res.status(400).json({ error: 'mondayItemId is required.' })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        // Confirm the stored id still belongs to this order number before
        // attaching a document link to it.
        const documentLink = await assertMondayLink({
          orderNumber: context.orderNumber,
          storedItemId: mondayItemId,
        })

        const snapshot = await fetchMondayBoardItemsByIds({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          itemIds: [mondayItemId],
        })
        const liveOrder = Array.isArray(snapshot?.orders)
          ? snapshot.orders[0]
          : null

        if (!liveOrder) {
          return res.status(404).json({
            error: 'Monday item was not found on the configured board.',
          })
        }

        const shopDrawingColumnId = String(snapshot?.columnDetection?.shopDrawingColumnId ?? '').trim()

        if (!shopDrawingColumnId) {
          return res.status(409).json({
            error: 'Shop drawing column could not be resolved for this board.',
          })
        }

        await clearMondayColumnValue({
          boardId: documentLink.boardId,
          itemId: documentLink.itemId,
          columnId: shopDrawingColumnId,
        })

        const {
          liveOrder: refreshedLiveOrder,
          resolvedBoardName,
          resolvedBoardUrl,
          progressStatusDetails,
        } = await pullLiveMondayProgressDetails({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          mondayItemId,
        })

        const syncResult = await syncMondayProgressDetailsToCollections({
          mondayItemId,
          boardId: context.boardId,
          boardName: resolvedBoardName,
          boardUrl: resolvedBoardUrl,
          liveOrder: refreshedLiveOrder,
          progressStatusDetails,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        const now = new Date().toISOString()
        const refreshedShopDrawingUrl =
          normalizeOptionalShortText(refreshedLiveOrder?.shopDrawingUrl, 800)
          || null

        await Promise.all([
          mondayCards.updateOneCompat(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                shopDrawingStoragePath: null,
                shopDrawingDownloadUrl: null,
                shopDrawingContentType: null,
                shopDrawingCachedAt: null,
                shopDrawingCacheStatus: refreshedShopDrawingUrl ? 'ready' : 'cleared',
                shopDrawingCacheError: null,
                shopDrawingFileName: null,
                shopDrawingSourceAssetId: null,
                shopDrawingSourceUrl: null,
                shopDrawingResolvedUrl: null,
                shopDrawingUrl: null,
                mondayUpdatedAt: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSeenAt: now,
              },
            },
            { upsert: true },
          ),
          ordersUnifiedCollection.updateOne(
            { monday_item_id: mondayItemId },
            {
              $set: {
                has_monday_record: true,
                monday_item_id: mondayItemId,
                monday_board_id: context.boardId,
                monday_board_name: resolvedBoardName,
                Shop_drawing_cached: null,
                Shop_drawing_source: refreshedShopDrawingUrl,
                Shop_drawing: refreshedShopDrawingUrl,
                monday_updated_at: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSyncedAt: now,
              },
            },
            { upsert: true },
          ),
        ])

        let refreshWarning = null

        try {
          await refreshOrdersUnifiedCollection()
        } catch (refreshError) {
          refreshWarning = refreshError instanceof Error
            ? refreshError.message
            : 'Shop drawing saved to Monday, but unified refresh failed.'
        }

        const updatedOrderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              order_number: 1,
              Shop_drawing_cached: 1,
              Shop_drawing_source: 1,
              monday_updated_at: 1,
            },
          },
        )

        return res.json({
          ok: true,
          order: {
            mondayItemId,
            orderNumber: String(updatedOrderDocument?.order_number ?? '').trim() || null,
            shopDrawingCachedUrl:
              String(updatedOrderDocument?.Shop_drawing_cached ?? '').trim()
              || null,
            shopDrawingUrl:
              String(updatedOrderDocument?.Shop_drawing_source ?? '').trim()
              || refreshedShopDrawingUrl
              || null,
            mondayUpdatedAt:
              String(updatedOrderDocument?.monday_updated_at ?? '').trim()
              || syncResult.mondayUpdatedAt,
          },
          warning: refreshWarning,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/cut-list/upload — office/manager/admin replace flow
  // for cut lists with Monday write-through.
  app.post(
    '/api/orders/monday/cut-list/upload',
    requireFirebaseAuth,
    requireOfficeManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const mimeType = String(req.body?.mimeType ?? 'application/pdf')
          .trim()
          .toLowerCase()
        const requestedFileName = String(req.body?.fileName ?? '').trim()
        const base64Payload = req.body?.fileBase64
          ?? req.body?.fileData
          ?? req.body?.data
          ?? null

        if (!mondayItemId) {
          return res.status(400).json({ error: 'mondayItemId is required.' })
        }

        if (!requestedFileName) {
          return res.status(400).json({ error: 'fileName is required.' })
        }

        if (!shippingDocumentMimeTypes.has(mimeType)) {
          return res.status(400).json({ error: 'Unsupported document mimeType.' })
        }

        const fileBuffer = decodeBase64Image(base64Payload)

        if (!fileBuffer || fileBuffer.length <= 0) {
          return res.status(400).json({ error: 'fileBase64 is required.' })
        }

        if (fileBuffer.length > 10 * 1024 * 1024) {
          return res.status(400).json({ error: 'File exceeds 10MB limit.' })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        // Confirm the stored id still belongs to this order number before
        // attaching a document link to it.
        const documentLink = await assertMondayLink({
          orderNumber: context.orderNumber,
          storedItemId: mondayItemId,
        })

        const snapshot = await fetchMondayBoardItemsByIds({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          itemIds: [mondayItemId],
        })
        const liveOrder = Array.isArray(snapshot?.orders)
          ? snapshot.orders[0]
          : null

        if (!liveOrder) {
          return res.status(404).json({
            error: 'Monday item was not found on the configured board.',
          })
        }

        const cutListColumnId = String(snapshot?.columnDetection?.cutListColumnId ?? '').trim()

        if (!cutListColumnId) {
          return res.status(409).json({
            error: 'Cut list column could not be resolved for this board.',
          })
        }

        const bucket = typeof getOrderPhotosBucket === 'function'
          ? getOrderPhotosBucket()
          : null

        if (!bucket) {
          throw Object.assign(new Error('Order photo storage bucket is unavailable.'), { status: 500 })
        }

        const orderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              order_number: 1,
              order_name: 1,
            },
          },
        )

        const storageOrderId = sanitizeStorageSegment(
          orderDocument?.order_number || mondayItemId,
          'order',
        )
        const storedFileName = ensureShippingDocumentFileName(
          requestedFileName,
          mimeType,
          `${storageOrderId}-cut-list.pdf`,
        )
        const storagePath = `orders-cut-lists/${storageOrderId}/${Date.now()}-${storedFileName}`
        const downloadToken = typeof randomUUID === 'function'
          ? randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
        const now = new Date().toISOString()

        await bucket.file(storagePath).save(fileBuffer, {
          resumable: false,
          metadata: {
            contentType: mimeType,
            metadata: {
              firebaseStorageDownloadTokens: downloadToken,
              mondayItemId,
              orderNumber: String(orderDocument?.order_number ?? '').trim() || null,
              uploadedAt: now,
            },
          },
        })

        const downloadUrl = buildFirebaseStorageDownloadUrl(bucket.name, storagePath, downloadToken)

        await updateMondayLinkColumnValue({
          boardId: documentLink.boardId,
          itemId: documentLink.itemId,
          columnId: cutListColumnId,
          urlValue: downloadUrl,
          linkText: storedFileName,
        })

        const {
          liveOrder: refreshedLiveOrder,
          resolvedBoardName,
          resolvedBoardUrl,
          progressStatusDetails,
        } = await pullLiveMondayProgressDetails({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          mondayItemId,
        })

        const syncResult = await syncMondayProgressDetailsToCollections({
          mondayItemId,
          boardId: context.boardId,
          boardName: resolvedBoardName,
          boardUrl: resolvedBoardUrl,
          liveOrder: refreshedLiveOrder,
          progressStatusDetails,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        const refreshedCutListUrl =
          normalizeOptionalShortText(refreshedLiveOrder?.cutListUrl, 800)
          || downloadUrl

        await Promise.all([
          mondayCards.updateOneCompat(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                cutListStoragePath: storagePath,
                cutListDownloadUrl: downloadUrl,
                cutListContentType: mimeType,
                cutListCachedAt: now,
                cutListCacheStatus: 'ready',
                cutListCacheError: null,
                cutListFileName: storedFileName,
                cutListSourceAssetId: null,
                cutListSourceUrl: null,
                cutListResolvedUrl: null,
                cutListUrl: null,
                cutListDocuments: nextCutListDocuments,
                mondayUpdatedAt: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSeenAt: now,
              },
            },
            { upsert: true },
          ),
          ordersUnifiedCollection.updateOne(
            { monday_item_id: mondayItemId },
            {
              $set: {
                has_monday_record: true,
                monday_item_id: mondayItemId,
                monday_board_id: context.boardId,
                monday_board_name: resolvedBoardName,
                Cut_list_cached: downloadUrl,
                Cut_list_source: refreshedCutListUrl,
                Cut_list: downloadUrl,
                cut_list_documents: nextCutListDocuments,
                monday_updated_at: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSyncedAt: now,
              },
            },
            { upsert: true },
          ),
        ])

        let refreshWarning = null

        try {
          await refreshOrdersUnifiedCollection()
        } catch (refreshError) {
          refreshWarning = refreshError instanceof Error
            ? refreshError.message
            : 'Cut list saved to Monday, but unified refresh failed.'
        }

        await ordersUnifiedCollection.updateOne(
          { monday_item_id: mondayItemId },
          {
            $set: {
              Cut_list_cached: downloadUrl,
              Cut_list: downloadUrl,
              cut_list_documents: nextCutListDocuments,
              updatedAt: now,
            },
          },
        )

        const updatedOrderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              order_number: 1,
              Cut_list_cached: 1,
              Cut_list_source: 1,
              cut_list_documents: 1,
              monday_updated_at: 1,
            },
          },
        )

        return res.status(201).json({
          ok: true,
          document: {
            fileName: storedFileName,
            mimeType,
            url: downloadUrl,
            uploadedAt: now,
          },
          order: {
            mondayItemId,
            orderNumber: String(updatedOrderDocument?.order_number ?? '').trim() || null,
            cutListCachedUrl:
              String(updatedOrderDocument?.Cut_list_cached ?? '').trim()
              || downloadUrl,
            cutListUrl:
              String(updatedOrderDocument?.Cut_list_source ?? '').trim()
              || refreshedCutListUrl
              || null,
            cutListDocuments: normalizeCutListDocuments(
              updatedOrderDocument?.cut_list_documents,
            ),
            mondayUpdatedAt:
              String(updatedOrderDocument?.monday_updated_at ?? '').trim()
              || syncResult.mondayUpdatedAt,
          },
          warning: refreshWarning,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/cut-list/delete — office/manager/admin clear flow
  // for cut lists with Monday write-through.
  app.get(
    '/api/orders/monday/cut-list/preview',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.query?.mondayItemId ?? '').trim()
        const requestedDocumentUrl = normalizeOptionalShortText(
          req.query?.documentUrl,
          1200,
        )

        if (!mondayItemId || !requestedDocumentUrl) {
          return res.status(400).json({
            error: 'mondayItemId and documentUrl are required.',
          })
        }

        const { ordersUnifiedCollection } = await getCollections()
        const orderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              Cut_list_cached: 1,
              Cut_list_source: 1,
              cut_list_documents: 1,
            },
          },
        )

        if (!orderDocument) {
          return res.status(404).json({ error: 'Order was not found.' })
        }

        const storedDocuments = normalizeCutListDocuments(
          orderDocument?.cut_list_documents,
        )
        const legacyUrls = [
          normalizeOptionalShortText(orderDocument?.Cut_list_cached, 1200),
          normalizeOptionalShortText(orderDocument?.Cut_list_source, 1200),
        ].filter(Boolean)
        const storedDocument = storedDocuments.find(
          (document) => document.url === requestedDocumentUrl,
        )
        const isStoredLegacyUrl = legacyUrls.includes(requestedDocumentUrl)

        if (!storedDocument && !isStoredLegacyUrl) {
          return res.status(404).json({ error: 'Cut List was not found on this order.' })
        }

        const forwardedProtocol = String(req.get('x-forwarded-proto') ?? '')
          .split(',')[0]
          .trim()
        const requestOrigin = `${forwardedProtocol || req.protocol}://${req.get('host')}`
        const sourceUrl = new URL(requestedDocumentUrl, requestOrigin)

        if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
          return res.status(400).json({ error: 'Cut List URL is not supported.' })
        }

        const sourceHeaders = {}
        if (sourceUrl.origin === requestOrigin && req.get('authorization')) {
          sourceHeaders.authorization = req.get('authorization')
        }

        const sourceResponse = await fetch(sourceUrl, {
          headers: sourceHeaders,
          redirect: 'follow',
          signal: AbortSignal.timeout(30_000),
        })

        if (!sourceResponse.ok) {
          return res.status(502).json({
            error: `Could not load Cut List source (${sourceResponse.status}).`,
          })
        }

        const contentLength = Number(sourceResponse.headers.get('content-length'))
        if (Number.isFinite(contentLength) && contentLength > 50 * 1024 * 1024) {
          return res.status(413).json({ error: 'Cut List is too large to preview.' })
        }

        const fileBuffer = Buffer.from(await sourceResponse.arrayBuffer())
        if (fileBuffer.length > 50 * 1024 * 1024) {
          return res.status(413).json({ error: 'Cut List is too large to preview.' })
        }

        const fileName = sanitizeDownloadFileName(
          storedDocument?.fileName || 'cut-list.pdf',
        )
        const contentType =
          String(storedDocument?.mimeType ?? '').trim()
          || String(sourceResponse.headers.get('content-type') ?? '').split(';')[0].trim()
          || 'application/octet-stream'

        res.setHeader('Content-Type', contentType)
        res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`)
        res.setHeader('Cache-Control', 'private, max-age=60')
        return res.status(200).send(fileBuffer)
      } catch (error) {
        next(error)
      }
    },
  )

  app.post(
    '/api/orders/monday/cut-list/delete',
    requireFirebaseAuth,
    requireOfficeManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const requestedDocumentUrl = normalizeOptionalShortText(
          req.body?.documentUrl,
          1200,
        )

        if (!mondayItemId) {
          return res.status(400).json({ error: 'mondayItemId is required.' })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        // Confirm the stored id still belongs to this order number before
        // attaching a document link to it.
        const documentLink = await assertMondayLink({
          orderNumber: context.orderNumber,
          storedItemId: mondayItemId,
        })

        const snapshot = await fetchMondayBoardItemsByIds({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          itemIds: [mondayItemId],
        })
        const liveOrder = Array.isArray(snapshot?.orders)
          ? snapshot.orders[0]
          : null

        if (!liveOrder) {
          return res.status(404).json({
            error: 'Monday item was not found on the configured board.',
          })
        }

        const cutListColumnId = String(snapshot?.columnDetection?.cutListColumnId ?? '').trim()

        if (!cutListColumnId) {
          return res.status(409).json({
            error: 'Cut list column could not be resolved for this board.',
          })
        }

        const orderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              order_number: 1,
              Cut_list_cached: 1,
              Cut_list_source: 1,
              cut_list_documents: 1,
            },
          },
        )
        const existingCutListDocuments = normalizeCutListDocuments(
          orderDocument?.cut_list_documents,
        )
        const currentLegacyUrl =
          normalizeOptionalShortText(orderDocument?.Cut_list_cached, 1200)
          || normalizeOptionalShortText(orderDocument?.Cut_list_source, 1200)
          || null

        if (
          currentLegacyUrl
          && !existingCutListDocuments.some((document) => document.url === currentLegacyUrl)
        ) {
          existingCutListDocuments.push({
            fileName: 'cut-list.pdf',
            mimeType: 'application/pdf',
            url: currentLegacyUrl,
            uploadedAt: null,
            storagePath: null,
          })
        }

        const removedDocument = requestedDocumentUrl
          ? existingCutListDocuments.find(
              (document) => document.url === requestedDocumentUrl,
            )
          : null

        if (requestedDocumentUrl && !removedDocument) {
          return res.status(404).json({ error: 'Cut list was not found.' })
        }

        const remainingCutListDocuments = requestedDocumentUrl
          ? existingCutListDocuments.filter(
              (document) => document.url !== requestedDocumentUrl,
            )
          : []
        const latestCutListDocument =
          remainingCutListDocuments[remainingCutListDocuments.length - 1]
          || null

        if (latestCutListDocument) {
          await updateMondayLinkColumnValue({
            boardId: documentLink.boardId,
            itemId: documentLink.itemId,
            columnId: cutListColumnId,
            urlValue: latestCutListDocument.url,
            linkText: latestCutListDocument.fileName,
          })
        } else {
          await clearMondayColumnValue({
            boardId: documentLink.boardId,
            itemId: documentLink.itemId,
            columnId: cutListColumnId,
          })
        }

        const {
          liveOrder: refreshedLiveOrder,
          resolvedBoardName,
          resolvedBoardUrl,
          progressStatusDetails,
        } = await pullLiveMondayProgressDetails({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          mondayItemId,
        })

        const syncResult = await syncMondayProgressDetailsToCollections({
          mondayItemId,
          boardId: context.boardId,
          boardName: resolvedBoardName,
          boardUrl: resolvedBoardUrl,
          liveOrder: refreshedLiveOrder,
          progressStatusDetails,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        const now = new Date().toISOString()
        const refreshedCutListUrl =
          latestCutListDocument?.url
          || normalizeOptionalShortText(refreshedLiveOrder?.cutListUrl, 800)
          || null

        if (removedDocument?.storagePath) {
          const bucket = typeof getOrderPhotosBucket === 'function'
            ? getOrderPhotosBucket()
            : null

          if (bucket) {
            await bucket.file(removedDocument.storagePath).delete({ ignoreNotFound: true })
          }
        }

        await Promise.all([
          mondayCards.updateOneCompat(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                cutListStoragePath: latestCutListDocument?.storagePath || null,
                cutListDownloadUrl: latestCutListDocument?.url || null,
                cutListContentType: latestCutListDocument?.mimeType || null,
                cutListCachedAt: latestCutListDocument?.uploadedAt || null,
                cutListCacheStatus: refreshedCutListUrl ? 'ready' : 'cleared',
                cutListCacheError: null,
                cutListFileName: latestCutListDocument?.fileName || null,
                cutListSourceAssetId: null,
                cutListSourceUrl: null,
                cutListResolvedUrl: null,
                cutListUrl: null,
                cutListDocuments: remainingCutListDocuments,
                mondayUpdatedAt: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSeenAt: now,
              },
            },
            { upsert: true },
          ),
          ordersUnifiedCollection.updateOne(
            { monday_item_id: mondayItemId },
            {
              $set: {
                has_monday_record: true,
                monday_item_id: mondayItemId,
                monday_board_id: context.boardId,
                monday_board_name: resolvedBoardName,
                Cut_list_cached: latestCutListDocument?.url || null,
                Cut_list_source: refreshedCutListUrl,
                Cut_list: refreshedCutListUrl,
                cut_list_documents: remainingCutListDocuments,
                monday_updated_at: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSyncedAt: now,
              },
            },
            { upsert: true },
          ),
        ])

        return res.json({
          ok: true,
          order: {
            mondayItemId,
            orderNumber: String(orderDocument?.order_number ?? '').trim() || null,
            cutListCachedUrl: latestCutListDocument?.url || null,
            cutListUrl: refreshedCutListUrl,
            cutListDocuments: remainingCutListDocuments,
            mondayUpdatedAt: syncResult.mondayUpdatedAt,
          },
          warning: null,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/documents/upload — upload shipping documents to Firebase
  // Storage, then persist the URL on the unified order row.
  app.post(
    '/api/orders/documents/upload',
    requireFirebaseAuth,
    requireOfficeManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const documentType = normalizeShippingDocumentType(req.body?.documentType)
        const mimeType = String(req.body?.mimeType ?? 'application/pdf')
          .trim()
          .toLowerCase()
        const base64Payload = req.body?.fileBase64
          ?? req.body?.fileData
          ?? req.body?.data
          ?? null
        const requestedFileName = String(req.body?.fileName ?? '').trim()
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

        if (!documentType) {
          return res.status(400).json({
            error: 'documentType must be signed_bol, customer_signed_bol, customer_signed_change_order, inspection_sheet, or acknowledgment.',
          })
        }

        if (!shippingDocumentMimeTypes.has(mimeType)) {
          return res.status(400).json({
            error: 'Unsupported document mimeType.',
          })
        }

        const fileBuffer = decodeBase64Image(base64Payload)

        if (!fileBuffer || fileBuffer.length <= 0) {
          return res.status(400).json({
            error: 'fileBase64 is required.',
          })
        }

        if (fileBuffer.length > 10 * 1024 * 1024) {
          return res.status(400).json({
            error: 'File exceeds 10MB limit.',
          })
        }

        const {
          ordersUnifiedCollection,
        } = await getCollections()
        const bucket = typeof getOrderPhotosBucket === 'function'
          ? getOrderPhotosBucket()
          : null

        if (!bucket) {
          throw Object.assign(new Error('Order photo storage bucket is unavailable.'), { status: 500 })
        }

        const orderDocument = await ordersUnifiedCollection.findOne(
          orderIdentityFilter,
          {
            projection: {
              _id: 1,
              orderKey: 1,
              monday_item_id: 1,
              order_number: 1,
              is_shipped: 1,
              signed_bol: 1,
              Signed_BOL_source: 1,
              Signed_BOL: 1,
              customer_signed_bol: 1,
              Customer_Signed_BOL_source: 1,
              Customer_Signed_BOL: 1,
              pending_order_change: 1,
              change_version: 1,
              customer_signed_change_order: 1,
              customer_signed_change_order_url: 1,
              Customer_Signed_Change_Order: 1,
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
              acknowledgment_document: 1,
              Acknowledgment_source: 1,
              Acknowledgment: 1,
            },
          },
        )

        if (!orderDocument) {
          return res.status(404).json({
            error: 'Order was not found.',
          })
        }

        if (
          documentType === 'customer_signed_bol'
          && !(
            String(orderDocument?.Signed_BOL_source ?? '').trim()
            || String(orderDocument?.Signed_BOL ?? '').trim()
          )
        ) {
          return res.status(409).json({
            error: 'Upload the Driver Signed BOL before the Customer Signed BOL.',
          })
        }

        if (
          documentType === 'customer_signed_change_order'
          && orderDocument?.pending_order_change?.status !== 'awaiting_customer_signature'
        ) {
          return res.status(409).json({
            error: 'There is no pending Change Order awaiting a customer signature.',
          })
        }

        const documentFields = resolveShippingDocumentFieldNames(documentType)
        const now = new Date().toISOString()
        const storageOrderId = sanitizeStorageSegment(
          orderDocument?.order_number
          || orderDocument?.monday_item_id
          || orderDocument?.orderKey
          || req.body?.orderNumber,
          'order',
        )
        const storedFileName = ensureShippingDocumentFileName(
          requestedFileName,
          mimeType,
          `${storageOrderId}-${documentFields.storageFolder}.pdf`,
        )
        const storagePath = `orders-shipping-docs/${storageOrderId}/${documentFields.storageFolder}/${Date.now()}-${storedFileName}`
        const downloadToken = typeof randomUUID === 'function'
          ? randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`

        await bucket.file(storagePath).save(fileBuffer, {
          resumable: false,
          metadata: {
            contentType: mimeType,
            metadata: {
              firebaseStorageDownloadTokens: downloadToken,
              orderKey: String(orderDocument?.orderKey ?? '').trim() || null,
              mondayItemId: String(orderDocument?.monday_item_id ?? '').trim() || null,
              orderNumber: String(orderDocument?.order_number ?? '').trim() || null,
              documentType,
              uploadedAt: now,
            },
          },
        })

        const downloadUrl = buildFirebaseStorageDownloadUrl(bucket.name, storagePath, downloadToken)
        // Resolved above; key the write on the immutable _id.
        const updateFilter = orderDocument?._id ? { _id: orderDocument._id } : null

        if (!updateFilter) {
          return res.status(409).json({
            error: 'Could not resolve order identity for document update.',
          })
        }

        const documentUpdate = {
          [documentFields.fileNameField]: storedFileName,
          [documentFields.urlFieldPrimary]: downloadUrl,
          [documentFields.urlFieldLegacy]: downloadUrl,
          [documentFields.uploadedAtField]: now,
          [documentFields.storagePathField]: storagePath,
          [documentFields.mimeTypeField]: mimeType,
          updatedAt: now,
          lastSyncedAt: now,
        }

        if (documentType === 'customer_signed_change_order') {
          const pendingChange = orderDocument.pending_order_change
          documentUpdate.source_quote_snapshot = pendingChange.revisedSnapshot
          documentUpdate.canonical_product_value = Number(pendingChange.productNet || 0)
          documentUpdate.canonical_order_value = Number(pendingChange.productNet || 0)
            + Number(pendingChange.freightNet || 0)
          documentUpdate.canonical_freight_value = Number(pendingChange.freightNet || 0)
          documentUpdate.orderValue = Number(pendingChange.productNet || 0)
            + Number(pendingChange.freightNet || 0)
          documentUpdate.freightValue = Number(pendingChange.freightNet || 0)
          documentUpdate.website_calculated_order_total =
            Number(pendingChange.productNet || 0) + Number(pendingChange.freightNet || 0)
          documentUpdate.website_calculated_order_total_at = now
          documentUpdate.change_version = Number(pendingChange.version || 1)
          documentUpdate.change_order_status = 'approved'
          documentUpdate.pending_order_change = null
          documentUpdate.order_confirmation_url = null
          documentUpdate.order_confirmation_name = null
          documentUpdate.work_order_url = null
          documentUpdate.work_order_name = null
          documentUpdate.proforma_invoice_url = null
          documentUpdate.proforma_invoice_name = null
          documentUpdate.invoice_pdf_cached_url = null
          documentUpdate.invoice_pdf_file_name = null
        }

        const updateCommand = {
          $set: documentUpdate,
        }

        if (documentType === 'customer_signed_change_order') {
          updateCommand.$push = {
            change_order_history: {
              $each: [{
                version: Number(orderDocument.pending_order_change?.version || 1),
                status: 'approved',
                lines: orderDocument.pending_order_change?.lines || [],
                productNet: Number(orderDocument.pending_order_change?.productNet || 0),
                freightNet: Number(orderDocument.pending_order_change?.freightNet || 0),
                changeOrderUrl: orderDocument.pending_order_change?.changeOrderUrl || null,
                changeOrderName: orderDocument.pending_order_change?.changeOrderName || null,
                customerSignedUrl: downloadUrl,
                customerSignedName: storedFileName,
                approvedAt: now,
                approvedByUid: String(req.authUser?.uid ?? '').trim() || null,
                approvedByEmail: String(req.authUser?.email ?? '').trim() || null,
              }],
              $slice: -50,
            },
          }
        }

        await ordersUnifiedCollection.updateOne(
          updateFilter,
          updateCommand,
        )

        const refreshedOrderDocument = await ordersUnifiedCollection.findOne(
          updateFilter,
          {
            projection: {
              _id: 0,
              orderKey: 1,
              monday_item_id: 1,
              order_number: 1,
              is_shipped: 1,
              signed_bol: 1,
              Signed_BOL_source: 1,
              Signed_BOL: 1,
              customer_signed_bol: 1,
              Customer_Signed_BOL_source: 1,
              Customer_Signed_BOL: 1,
              customer_signed_change_order: 1,
              customer_signed_change_order_url: 1,
              Customer_Signed_Change_Order: 1,
              change_version: 1,
              change_order_status: 1,
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
              acknowledgment_document: 1,
              Acknowledgment_source: 1,
              Acknowledgment: 1,
            },
          },
        )

        return res.status(201).json({
          ok: true,
          document: {
            type: documentType,
            label: documentFields.documentLabel,
            fileName: storedFileName,
            mimeType,
            url: downloadUrl,
            uploadedAt: now,
          },
          order: {
            orderKey: String(refreshedOrderDocument?.orderKey ?? '').trim() || null,
            mondayItemId: String(refreshedOrderDocument?.monday_item_id ?? '').trim() || null,
            orderNumber: String(refreshedOrderDocument?.order_number ?? '').trim() || null,
            isShipped: Boolean(refreshedOrderDocument?.is_shipped),
            signedBol: String(refreshedOrderDocument?.signed_bol ?? '').trim() || null,
            signedBolUrl:
              String(refreshedOrderDocument?.Signed_BOL_source ?? '').trim()
              || String(refreshedOrderDocument?.Signed_BOL ?? '').trim()
              || null,
            customerSignedBol: String(refreshedOrderDocument?.customer_signed_bol ?? '').trim() || null,
            customerSignedBolUrl:
              String(refreshedOrderDocument?.Customer_Signed_BOL_source ?? '').trim()
              || String(refreshedOrderDocument?.Customer_Signed_BOL ?? '').trim()
              || null,
            customerSignedChangeOrder:
              String(refreshedOrderDocument?.customer_signed_change_order ?? '').trim() || null,
            customerSignedChangeOrderUrl:
              String(refreshedOrderDocument?.customer_signed_change_order_url ?? '').trim()
              || String(refreshedOrderDocument?.Customer_Signed_Change_Order ?? '').trim()
              || null,
            changeVersion: Number.isFinite(Number(refreshedOrderDocument?.change_version))
              ? Number(refreshedOrderDocument.change_version)
              : 0,
            changeOrderStatus: String(refreshedOrderDocument?.change_order_status ?? '').trim() || null,
            inspectionSheet: String(refreshedOrderDocument?.inspection_sheet ?? '').trim() || null,
            inspectionSheetUrl:
              String(refreshedOrderDocument?.Inspection_sheet_source ?? '').trim()
              || String(refreshedOrderDocument?.Inspection_sheet ?? '').trim()
              || null,
            acknowledgmentDocument: String(refreshedOrderDocument?.acknowledgment_document ?? '').trim() || null,
            acknowledgmentDocumentUrl:
              String(refreshedOrderDocument?.Acknowledgment_source ?? '').trim()
              || String(refreshedOrderDocument?.Acknowledgment ?? '').trim()
              || null,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/ship — move an order from Order Track to Shipped in
  // Monday after required website shipping docs are uploaded.
  app.post(
    '/api/orders/documents/delete',
    requireFirebaseAuth,
    requireOfficeManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const documentType = normalizeShippingDocumentType(req.body?.documentType)
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

        if (!documentType) {
          return res.status(400).json({
            error: 'documentType must be signed_bol, customer_signed_bol, customer_signed_change_order, inspection_sheet, or acknowledgment.',
          })
        }

        const {
          ordersUnifiedCollection,
        } = await getCollections()
        const bucket = typeof getOrderPhotosBucket === 'function'
          ? getOrderPhotosBucket()
          : null

        const orderDocument = await ordersUnifiedCollection.findOne(
          orderIdentityFilter,
          {
            projection: {
              _id: 1,
              orderKey: 1,
              monday_item_id: 1,
              order_number: 1,
              is_shipped: 1,
              signed_bol: 1,
              Signed_BOL_source: 1,
              Signed_BOL: 1,
              signed_bol_storage_path: 1,
              customer_signed_bol: 1,
              Customer_Signed_BOL_source: 1,
              Customer_Signed_BOL: 1,
              customer_signed_bol_storage_path: 1,
              customer_signed_change_order: 1,
              customer_signed_change_order_url: 1,
              Customer_Signed_Change_Order: 1,
              customer_signed_change_order_storage_path: 1,
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
              inspection_sheet_storage_path: 1,
              acknowledgment_document: 1,
              Acknowledgment_source: 1,
              Acknowledgment: 1,
              acknowledgment_storage_path: 1,
            },
          },
        )

        if (!orderDocument) {
          return res.status(404).json({
            error: 'Order was not found.',
          })
        }

        const documentFields = resolveShippingDocumentFieldNames(documentType)
        const currentStoragePath = String(orderDocument?.[documentFields.storagePathField] ?? '').trim()

        if (currentStoragePath && bucket) {
          try {
            await bucket.file(currentStoragePath).delete({ ignoreNotFound: true })
          } catch (storageDeleteError) {
            const storageErrorCode = Number(storageDeleteError?.code)

            if (storageErrorCode !== 404) {
              throw storageDeleteError
            }
          }
        }

        // Resolved above; key the write on the immutable _id.
        const updateFilter = orderDocument?._id ? { _id: orderDocument._id } : null

        if (!updateFilter) {
          return res.status(409).json({
            error: 'Could not resolve order identity for document delete.',
          })
        }

        const now = new Date().toISOString()

        await ordersUnifiedCollection.updateOne(
          updateFilter,
          {
            $set: {
              [documentFields.fileNameField]: null,
              [documentFields.urlFieldPrimary]: null,
              [documentFields.urlFieldLegacy]: null,
              [documentFields.uploadedAtField]: null,
              [documentFields.storagePathField]: null,
              [documentFields.mimeTypeField]: null,
              updatedAt: now,
              lastSyncedAt: now,
            },
          },
        )

        const refreshedOrderDocument = await ordersUnifiedCollection.findOne(
          updateFilter,
          {
            projection: {
              _id: 0,
              orderKey: 1,
              monday_item_id: 1,
              order_number: 1,
              is_shipped: 1,
              signed_bol: 1,
              Signed_BOL_source: 1,
              Signed_BOL: 1,
              customer_signed_bol: 1,
              Customer_Signed_BOL_source: 1,
              Customer_Signed_BOL: 1,
              customer_signed_change_order: 1,
              customer_signed_change_order_url: 1,
              Customer_Signed_Change_Order: 1,
              change_version: 1,
              change_order_status: 1,
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
              acknowledgment_document: 1,
              Acknowledgment_source: 1,
              Acknowledgment: 1,
            },
          },
        )

        return res.json({
          ok: true,
          document: {
            type: documentType,
            label: documentFields.documentLabel,
            deletedAt: now,
          },
          order: {
            orderKey: String(refreshedOrderDocument?.orderKey ?? '').trim() || null,
            mondayItemId: String(refreshedOrderDocument?.monday_item_id ?? '').trim() || null,
            orderNumber: String(refreshedOrderDocument?.order_number ?? '').trim() || null,
            isShipped: Boolean(refreshedOrderDocument?.is_shipped),
            signedBol: String(refreshedOrderDocument?.signed_bol ?? '').trim() || null,
            signedBolUrl:
              String(refreshedOrderDocument?.Signed_BOL_source ?? '').trim()
              || String(refreshedOrderDocument?.Signed_BOL ?? '').trim()
              || null,
            customerSignedBol: String(refreshedOrderDocument?.customer_signed_bol ?? '').trim() || null,
            customerSignedBolUrl:
              String(refreshedOrderDocument?.Customer_Signed_BOL_source ?? '').trim()
              || String(refreshedOrderDocument?.Customer_Signed_BOL ?? '').trim()
              || null,
            customerSignedChangeOrder:
              String(refreshedOrderDocument?.customer_signed_change_order ?? '').trim() || null,
            customerSignedChangeOrderUrl:
              String(refreshedOrderDocument?.customer_signed_change_order_url ?? '').trim()
              || String(refreshedOrderDocument?.Customer_Signed_Change_Order ?? '').trim()
              || null,
            changeVersion: Number.isFinite(Number(refreshedOrderDocument?.change_version))
              ? Number(refreshedOrderDocument.change_version)
              : 0,
            changeOrderStatus: String(refreshedOrderDocument?.change_order_status ?? '').trim() || null,
            inspectionSheet: String(refreshedOrderDocument?.inspection_sheet ?? '').trim() || null,
            inspectionSheetUrl:
              String(refreshedOrderDocument?.Inspection_sheet_source ?? '').trim()
              || String(refreshedOrderDocument?.Inspection_sheet ?? '').trim()
              || null,
            acknowledgmentDocument: String(refreshedOrderDocument?.acknowledgment_document ?? '').trim() || null,
            acknowledgmentDocumentUrl:
              String(refreshedOrderDocument?.Acknowledgment_source ?? '').trim()
              || String(refreshedOrderDocument?.Acknowledgment ?? '').trim()
              || null,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )
}
