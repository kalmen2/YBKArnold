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

export function registerOrderDocumentRoutes(app, {
  clearMondayColumnValue,
  decodeBase64Image,
  fetchMondayBoardItemsByIds,
  getCollections,
  getOrderPhotosBucket,
  pullLiveMondayProgressDetails,
  refreshOrdersUnifiedCollection,
  requireFirebaseAuth,
  requireManagerOrAdminRole,
  resolveMondayOrderContext,
  syncMondayProgressDetailsToCollections,
  updateMondayLinkColumnValue,
}) {
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

    if (normalized === 'inspection_sheet' || normalized === 'inspection-sheet') {
      return 'inspection_sheet'
    }

    return ''
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

  function resolveShippingDocumentFieldNames(documentType) {
    if (documentType === 'signed_bol') {
      return {
        documentLabel: 'Signed BOL',
        storageFolder: 'signed-bol',
        fileNameField: 'signed_bol',
        urlFieldPrimary: 'Signed_BOL_source',
        urlFieldLegacy: 'Signed_BOL',
        uploadedAtField: 'signed_bol_uploaded_at',
        storagePathField: 'signed_bol_storage_path',
        mimeTypeField: 'signed_bol_mime_type',
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

  // POST /api/orders/monday/shop-drawing/upload — manager-only replace flow
  // for shop drawings with Monday write-through.
  app.post(
    '/api/orders/monday/shop-drawing/upload',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
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

        await updateMondayLinkColumnValue({
          boardId: context.boardId,
          itemId: mondayItemId,
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
          mondayOrdersCollection.updateOne(
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

  // POST /api/orders/monday/shop-drawing/delete — manager-only clear flow
  // for shop drawings with Monday write-through.
  app.post(
    '/api/orders/monday/shop-drawing/delete',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
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
          boardId: context.boardId,
          itemId: mondayItemId,
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
          mondayOrdersCollection.updateOne(
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

  // POST /api/orders/monday/cut-list/upload — manager-only replace flow
  // for cut lists with Monday write-through.
  app.post(
    '/api/orders/monday/cut-list/upload',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
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
          boardId: context.boardId,
          itemId: mondayItemId,
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
          mondayOrdersCollection.updateOne(
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

        const updatedOrderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              order_number: 1,
              Cut_list_cached: 1,
              Cut_list_source: 1,
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

  // POST /api/orders/monday/cut-list/delete — manager-only clear flow
  // for cut lists with Monday write-through.
  app.post(
    '/api/orders/monday/cut-list/delete',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
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

        await clearMondayColumnValue({
          boardId: context.boardId,
          itemId: mondayItemId,
          columnId: cutListColumnId,
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
        const refreshedCutListUrl =
          normalizeOptionalShortText(refreshedLiveOrder?.cutListUrl, 800)
          || null

        await Promise.all([
          mondayOrdersCollection.updateOne(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                cutListStoragePath: null,
                cutListDownloadUrl: null,
                cutListContentType: null,
                cutListCachedAt: null,
                cutListCacheStatus: refreshedCutListUrl ? 'ready' : 'cleared',
                cutListCacheError: null,
                cutListFileName: null,
                cutListSourceAssetId: null,
                cutListSourceUrl: null,
                cutListResolvedUrl: null,
                cutListUrl: null,
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
                Cut_list_cached: null,
                Cut_list_source: refreshedCutListUrl,
                Cut_list: refreshedCutListUrl,
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

        const updatedOrderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              order_number: 1,
              Cut_list_cached: 1,
              Cut_list_source: 1,
              monday_updated_at: 1,
            },
          },
        )

        return res.json({
          ok: true,
          order: {
            mondayItemId,
            orderNumber: String(updatedOrderDocument?.order_number ?? '').trim() || null,
            cutListCachedUrl:
              String(updatedOrderDocument?.Cut_list_cached ?? '').trim()
              || null,
            cutListUrl:
              String(updatedOrderDocument?.Cut_list_source ?? '').trim()
              || refreshedCutListUrl
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

  // POST /api/orders/documents/upload — upload shipping documents to Firebase
  // Storage, then persist the URL on the unified order row.
  app.post(
    '/api/orders/documents/upload',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
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
            error: 'documentType must be signed_bol or inspection_sheet.',
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
              _id: 0,
              orderKey: 1,
              monday_item_id: 1,
              order_number: 1,
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
          return res.status(404).json({
            error: 'Order was not found.',
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
        const updateFilter = buildOrderIdentityFilter({
          orderKey: orderDocument?.orderKey,
          mondayItemId: orderDocument?.monday_item_id,
          orderNumber: orderDocument?.order_number,
        })

        if (!updateFilter) {
          return res.status(409).json({
            error: 'Could not resolve order identity for document update.',
          })
        }

        await ordersUnifiedCollection.updateOne(
          updateFilter,
          {
            $set: {
              [documentFields.fileNameField]: storedFileName,
              [documentFields.urlFieldPrimary]: downloadUrl,
              [documentFields.urlFieldLegacy]: downloadUrl,
              [documentFields.uploadedAtField]: now,
              [documentFields.storagePathField]: storagePath,
              [documentFields.mimeTypeField]: mimeType,
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
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
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
            inspectionSheet: String(refreshedOrderDocument?.inspection_sheet ?? '').trim() || null,
            inspectionSheetUrl:
              String(refreshedOrderDocument?.Inspection_sheet_source ?? '').trim()
              || String(refreshedOrderDocument?.Inspection_sheet ?? '').trim()
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
    requireManagerOrAdminRole,
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
            error: 'documentType must be signed_bol or inspection_sheet.',
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
              _id: 0,
              orderKey: 1,
              monday_item_id: 1,
              order_number: 1,
              is_shipped: 1,
              signed_bol: 1,
              Signed_BOL_source: 1,
              Signed_BOL: 1,
              signed_bol_storage_path: 1,
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
              inspection_sheet_storage_path: 1,
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

        const updateFilter = buildOrderIdentityFilter({
          orderKey: orderDocument?.orderKey,
          mondayItemId: orderDocument?.monday_item_id,
          orderNumber: orderDocument?.order_number,
        })

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
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
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
            inspectionSheet: String(refreshedOrderDocument?.inspection_sheet ?? '').trim() || null,
            inspectionSheetUrl:
              String(refreshedOrderDocument?.Inspection_sheet_source ?? '').trim()
              || String(refreshedOrderDocument?.Inspection_sheet ?? '').trim()
              || null,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )
}
