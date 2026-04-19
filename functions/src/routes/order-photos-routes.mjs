export function registerOrderPhotoRoutes(app, deps) {
  const {
    buildOrderPhotoDownloadFileName,
    decodeBase64Image,
    deleteOrderPhotoRecord,
    getOrderPhotosBucket,
    isSupportedPhotoMimeType,
    listAllOrderPhotoGroups,
    listOrderPhotoRecords,
    normalizeOrderPhotoOrderId,
    normalizeOrderPhotoPath,
    requireFirebaseAuth,
    saveOrderPhotoRecord,
  } = deps


app.get('/api/orders/photos-index', async (_req, res, next) => {
  try {
    const orders = await listAllOrderPhotoGroups()

    return res.json({
      generatedAt: new Date().toISOString(),
      orders,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/orders/:orderId/photos', async (req, res, next) => {
  try {
    const orderId = normalizeOrderPhotoOrderId(req.params.orderId)

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required.' })
    }

    const photos = await listOrderPhotoRecords(orderId)
    return res.json({ orderId, photos })
  } catch (error) {
    next(error)
  }
})

app.get('/api/orders/:orderId/photos/download', async (req, res, next) => {
  try {
    const orderId = normalizeOrderPhotoOrderId(req.params.orderId)

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required.' })
    }

    const queryPath = Array.isArray(req.query?.path)
      ? req.query.path[0]
      : req.query?.path
    const photoPath = normalizeOrderPhotoPath(orderId, queryPath)

    if (!photoPath) {
      return res.status(400).json({ error: 'A valid photo path is required.' })
    }

    const bucket = getOrderPhotosBucket()
    const file = bucket.file(photoPath)
    const [exists] = await file.exists()

    if (!exists) {
      return res.status(404).json({ error: 'Photo not found.' })
    }

    const [metadata] = await file.getMetadata()
    const contentType = String(metadata?.contentType ?? '').trim() || 'application/octet-stream'
    const fileName = buildOrderPhotoDownloadFileName(orderId, photoPath)

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.setHeader('Cache-Control', 'private, max-age=60')

    await new Promise((resolve, reject) => {
      const stream = file.createReadStream()

      stream.on('error', reject)
      stream.on('end', resolve)
      stream.pipe(res)
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/orders/:orderId/photos', requireFirebaseAuth, async (req, res, next) => {
  try {
    const orderId = normalizeOrderPhotoOrderId(req.params.orderId)

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required.' })
    }

    const mimeType = String(req.body?.mimeType ?? 'image/jpeg')
      .trim()
      .toLowerCase()

    if (!isSupportedPhotoMimeType(mimeType)) {
      return res.status(400).json({ error: 'Unsupported image mimeType.' })
    }

    const imageBuffer = decodeBase64Image(req.body?.imageBase64)

    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({ error: 'imageBase64 is required.' })
    }

    if (imageBuffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image exceeds 8MB limit.' })
    }

    const photo = await saveOrderPhotoRecord(orderId, imageBuffer, mimeType)

    return res.status(201).json({ orderId, photo })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/orders/:orderId/photos', requireFirebaseAuth, async (req, res, next) => {
  try {
    const orderId = normalizeOrderPhotoOrderId(req.params.orderId)

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required.' })
    }

    const queryPath = Array.isArray(req.query?.path)
      ? req.query.path[0]
      : req.query?.path
    const photoPath = normalizeOrderPhotoPath(
      orderId,
      req.body?.path ?? queryPath,
    )

    if (!photoPath) {
      return res.status(400).json({ error: 'A valid photo path is required.' })
    }

    const deleted = await deleteOrderPhotoRecord(orderId, photoPath)

    if (!deleted) {
      return res.status(404).json({ error: 'Photo not found.' })
    }

    return res.json({
      ok: true,
      orderId,
      path: photoPath,
    })
  } catch (error) {
    next(error)
  }
})

}
