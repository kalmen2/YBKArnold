export function sanitizeStoragePathSegment(value: string, fallback = 'item') {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || fallback
}

export function resolveFileExtension(file: File) {
  const normalizedName = String(file.name || '').toLowerCase()
  const extensionMatch = normalizedName.match(/\.[a-z0-9]{2,8}$/)

  if (extensionMatch) {
    return extensionMatch[0]
  }

  return '.bin'
}

export function resolveImageFileExtension(file: File) {
  const normalizedName = String(file.name || '').toLowerCase()
  const extensionMatch = normalizedName.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/)

  if (extensionMatch) {
    return extensionMatch[0]
  }

  if (file.type === 'image/png') return '.png'
  if (file.type === 'image/jpeg') return '.jpg'
  if (file.type === 'image/gif') return '.gif'
  if (file.type === 'image/webp') return '.webp'
  if (file.type === 'image/bmp') return '.bmp'
  if (file.type === 'image/svg+xml') return '.svg'

  return '.jpg'
}
