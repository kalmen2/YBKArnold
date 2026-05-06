type SplitQuickBooksProjectLabelOptions = {
  fallbackCustomerName?: string
  fallbackProjectNumber?: string
}

type SplitQuickBooksProjectLabelResult = {
  customerName: string
  projectNumber: string
}

export function splitQuickBooksProjectLabel(
  projectName: string,
  fallbackProjectId: string,
  options: SplitQuickBooksProjectLabelOptions = {},
): SplitQuickBooksProjectLabelResult {
  const normalizedName = String(projectName || '').trim()
  const fallbackCustomerName = options.fallbackCustomerName ?? '-'
  const fallbackProjectNumber = options.fallbackProjectNumber ?? (fallbackProjectId || '-')

  if (!normalizedName) {
    return {
      customerName: fallbackCustomerName,
      projectNumber: fallbackProjectNumber,
    }
  }

  const hasColonSeparator = normalizedName.includes(':')
  const hasHyphenSeparator = normalizedName.includes(' - ')
  const segments = hasColonSeparator
    ? normalizedName.split(':').map((segment) => segment.trim()).filter(Boolean)
    : hasHyphenSeparator
      ? normalizedName.split(' - ').map((segment) => segment.trim()).filter(Boolean)
      : [normalizedName]

  if (segments.length <= 1) {
    return {
      customerName: fallbackCustomerName,
      projectNumber: segments[0] || fallbackProjectNumber,
    }
  }

  return {
    customerName: segments.slice(0, -1).join(' : '),
    projectNumber: segments[segments.length - 1] || fallbackProjectNumber,
  }
}
