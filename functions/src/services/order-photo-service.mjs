import { randomUUID } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'

export function createOrderPhotoService({ firebaseStorageBucketName }) {
  function normalizeOrderPhotoOrderId(rawOrderId) {
    const normalized = String(rawOrderId ?? '').trim()

    if (!normalized) {
      return null
    }

    return normalized.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
  }

  function buildOrderPhotoPrefix(orderId) {
    return `order-photos/${orderId}/`
  }

  function isSupportedPhotoMimeType(mimeType) {
    return [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ].includes(String(mimeType ?? '').trim().toLowerCase())
  }

  function extensionForPhotoMimeType(mimeType) {
    const normalized = String(mimeType ?? '').trim().toLowerCase()

    switch (normalized) {
      case 'image/png':
        return 'png'
      case 'image/webp':
        return 'webp'
      case 'image/heic':
        return 'heic'
      case 'image/heif':
        return 'heif'
      default:
        return 'jpg'
    }
  }

  function decodeBase64Image(rawValue) {
    const normalized = String(rawValue ?? '').trim()

    if (!normalized) {
      return null
    }

    const withoutPrefix = normalized.includes(',')
      ? normalized.split(',').pop()
      : normalized
    const compact = String(withoutPrefix ?? '').replace(/\s+/g, '')

    if (!compact || !/^[a-zA-Z0-9+/=]+$/.test(compact)) {
      return null
    }

    try {
      return Buffer.from(compact, 'base64')
    } catch {
      return null
    }
  }

  function extractPhotoTimestampMsFromPath(path) {
    const fileName = String(path ?? '').split('/').pop() ?? ''
    const leadingPart = fileName.split('-')[0]
    const parsed = Number(leadingPart)

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null
    }

    return parsed
  }

  function extractOrderIdFromPhotoPath(path) {
    const pathParts = String(path ?? '').split('/')

    if (pathParts.length < 3 || pathParts[0] !== 'order-photos') {
      return null
    }

    return normalizeOrderPhotoOrderId(pathParts[1])
  }

  function getOrderPhotosBucket() {
    const storage = getStorage()

    return firebaseStorageBucketName
      ? storage.bucket(firebaseStorageBucketName)
      : storage.bucket()
  }

  function buildFirebaseStorageDownloadUrl(bucketName, objectPath, downloadToken) {
    const encodedObjectPath = encodeURIComponent(String(objectPath ?? '').trim())
    const encodedToken = encodeURIComponent(String(downloadToken ?? '').trim())

    return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodedObjectPath}?alt=media&token=${encodedToken}`
  }

  async function buildOrderPhotoRecord(file, bucketName) {
    const timestampMs = extractPhotoTimestampMsFromPath(file.name) ?? Date.now()
    const [metadata] = await file.getMetadata()
    const tokenList = String(metadata?.metadata?.firebaseStorageDownloadTokens ?? '')
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
    let downloadToken = tokenList[0] ?? null

    if (!downloadToken) {
      downloadToken = randomUUID()
      await file.setMetadata({
        metadata: {
          ...(metadata?.metadata ?? {}),
          firebaseStorageDownloadTokens: downloadToken,
        },
      })
    }

    const url = buildFirebaseStorageDownloadUrl(bucketName, file.name, downloadToken)

    return {
      path: file.name,
      url,
      createdAt: new Date(timestampMs).toISOString(),
    }
  }

  async function listOrderPhotoRecords(orderId) {
    const prefix = buildOrderPhotoPrefix(orderId)
    const bucket = getOrderPhotosBucket()
    const [files] = await bucket.getFiles({
      prefix,
      autoPaginate: false,
      maxResults: 200,
    })
    const usableFiles = files.filter((file) => file?.name && !file.name.endsWith('/'))
    const photoRecords = await Promise.all(
      usableFiles.map((file) => buildOrderPhotoRecord(file, bucket.name)),
    )

    return photoRecords.sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )
  }

  async function listAllOrderPhotoGroups() {
    const bucket = getOrderPhotosBucket()
    const [files] = await bucket.getFiles({
      prefix: 'order-photos/',
      autoPaginate: false,
      maxResults: 2000,
    })
    const usableFiles = files.filter((file) => file?.name && !file.name.endsWith('/'))
    const groupedPhotos = new Map()

    for (const file of usableFiles) {
      const orderId = extractOrderIdFromPhotoPath(file.name)

      if (!orderId) {
        continue
      }

      const photoRecord = await buildOrderPhotoRecord(file, bucket.name)
      const orderPhotos = groupedPhotos.get(orderId) ?? []
      orderPhotos.push(photoRecord)
      groupedPhotos.set(orderId, orderPhotos)
    }

    const groupedList = Array.from(groupedPhotos.entries()).map(([orderId, photos]) => ({
      orderId,
      photos: photos.sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      ),
    }))

    groupedList.sort((left, right) => {
      const leftMostRecent = left.photos[0]?.createdAt ?? ''
      const rightMostRecent = right.photos[0]?.createdAt ?? ''

      return Date.parse(rightMostRecent) - Date.parse(leftMostRecent)
    })

    return groupedList
  }

  async function saveOrderPhotoRecord(orderId, imageBuffer, mimeType) {
    const timestampMs = Date.now()
    const extension = extensionForPhotoMimeType(mimeType)
    const objectPath = `${buildOrderPhotoPrefix(orderId)}${timestampMs}-${randomUUID()}.${extension}`
    const downloadToken = randomUUID()
    const bucket = getOrderPhotosBucket()
    const file = bucket.file(objectPath)

    await file.save(imageBuffer, {
      resumable: false,
      metadata: {
        contentType: mimeType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          orderId,
          uploadedAt: new Date(timestampMs).toISOString(),
        },
      },
    })

    return buildOrderPhotoRecord(file, bucket.name)
  }

  function normalizeOrderPhotoPath(orderId, rawPath) {
    const normalizedPath = String(rawPath ?? '').trim().replace(/^\/+/, '')

    if (!normalizedPath) {
      return null
    }

    const expectedPrefix = buildOrderPhotoPrefix(orderId)

    if (!normalizedPath.startsWith(expectedPrefix) || normalizedPath.includes('..')) {
      return null
    }

    return normalizedPath
  }

  function buildOrderPhotoDownloadFileName(orderId, path) {
    const rawFileName = String(path ?? '').split('/').pop() ?? ''
    const safeFileName = rawFileName
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '_')

    if (safeFileName) {
      return safeFileName
    }

    const safeOrderId = String(orderId ?? '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')

    return `order-${safeOrderId || 'photo'}-image.jpg`
  }

  async function deleteOrderPhotoRecord(orderId, path) {
    const normalizedPath = normalizeOrderPhotoPath(orderId, path)

    if (!normalizedPath) {
      return false
    }

    const bucket = getOrderPhotosBucket()
    const file = bucket.file(normalizedPath)
    const [exists] = await file.exists()

    if (!exists) {
      return false
    }

    await file.delete()

    return true
  }

  return {
    buildOrderPhotoDownloadFileName,
    decodeBase64Image,
    deleteOrderPhotoRecord,
    getOrderPhotosBucket,
    isSupportedPhotoMimeType,
    listAllOrderPhotoGroups,
    listOrderPhotoRecords,
    normalizeOrderPhotoOrderId,
    normalizeOrderPhotoPath,
    saveOrderPhotoRecord,
  }
}
