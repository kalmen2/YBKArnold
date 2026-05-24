import ApiRoundedIcon from '@mui/icons-material/ApiRounded'
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import KeyRoundedIcon from '@mui/icons-material/KeyRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  createAdminApiKey,
  fetchAdminApiDocs,
  fetchAdminApiKeys,
  revokeAdminApiKey,
  type AdminApiFieldDoc,
  type AdminApiEndpointDoc,
} from '../features/admin-api/api'
import { formatDateTime } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type AdminApiTab = 'docs' | 'keys'
type AdminApiDocsSection = {
  id: string
  title: string
  description: string
  endpoints: AdminApiEndpointDoc[]
}

const keysLimit = 250

function methodColor(method: string): 'primary' | 'success' | 'warning' | 'default' {
  if (method === 'GET') {
    return 'primary'
  }

  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    return 'success'
  }

  if (method === 'DELETE') {
    return 'warning'
  }

  return 'default'
}

function resolveEndpointUrl(baseUrl: string, pathTemplate: string) {
  const normalizedBaseUrl = String(baseUrl ?? '').trim().replace(/\/+$/, '')

  if (!normalizedBaseUrl) {
    return pathTemplate
  }

  if (normalizedBaseUrl.endsWith('/api') && pathTemplate.startsWith('/api/')) {
    return `${normalizedBaseUrl}${pathTemplate.slice(4)}`
  }

  return `${normalizedBaseUrl}${pathTemplate}`
}

function resolveExampleCurl(baseUrl: string, endpoint: AdminApiEndpointDoc) {
  const fallback = `curl -X ${endpoint.method} "${resolveEndpointUrl(baseUrl, endpoint.pathTemplate)}"`
  const source = String(endpoint.exampleCurl ?? '').trim() || fallback

  return source.replace(endpoint.pathTemplate, resolveEndpointUrl(baseUrl, endpoint.pathTemplate))
}

function resolveAccessTags(endpoint: AdminApiEndpointDoc) {
  const tags: Array<{ label: string, color?: 'warning' | 'success' | 'default', variant?: 'filled' | 'outlined' }> = []

  if (endpoint.access.adminOnly) {
    tags.push({ label: 'Admin only', color: 'warning' })
  }

  if (endpoint.access.managerOrAdminOnly) {
    tags.push({ label: 'Manager/Admin', variant: 'outlined' })
  }

  if (endpoint.access.salesManagerOrAdminOnly) {
    tags.push({ label: 'Sales/Manager/Admin', variant: 'outlined' })
  }

  if (endpoint.access.approvedLinkedWorkerOnly) {
    tags.push({ label: 'Linked worker required', variant: 'outlined' })
  }

  if (endpoint.access.requiresAuth) {
    tags.push({ label: 'Authenticated', color: 'success', variant: 'outlined' })
  } else {
    tags.push({ label: 'Public', color: 'success' })
  }

  return tags
}

function formatFieldConstraintValue(value: number | string | boolean | null) {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  return String(value)
}

function formatFieldDocumentationLine(field: AdminApiFieldDoc) {
  const fragments = [
    `${field.name} (${field.type})`,
    field.required ? 'required' : 'optional',
  ]

  if (Array.isArray(field.enumValues) && field.enumValues.length > 0) {
    fragments.push(`allowed: ${field.enumValues.join(', ')}`)
  }

  const defaultValue = formatFieldConstraintValue(field.defaultValue)

  if (defaultValue) {
    fragments.push(`default: ${defaultValue}`)
  }

  const minimum = formatFieldConstraintValue(field.minimum)

  if (minimum) {
    fragments.push(`min: ${minimum}`)
  }

  const maximum = formatFieldConstraintValue(field.maximum)

  if (maximum) {
    fragments.push(`max: ${maximum}`)
  }

  return fragments.join(' | ')
}

function formatFieldDescription(field: AdminApiFieldDoc) {
  const description = String(field.description ?? '').trim()

  if (!description) {
    return ''
  }

  return description
}

export default function AdminApiPage() {
  const queryClient = useQueryClient()
  const [selectedTab, setSelectedTab] = useState<AdminApiTab>('docs')
  const [newKeyName, setNewKeyName] = useState('')
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isPdfExporting, setIsPdfExporting] = useState(false)

  const docsQuery = useQuery({
    queryKey: QUERY_KEYS.adminApiDocs,
    queryFn: () => fetchAdminApiDocs(),
    staleTime: 30 * 1000,
  })

  const keysQuery = useQuery({
    queryKey: QUERY_KEYS.adminApiKeys(keysLimit),
    queryFn: () => fetchAdminApiKeys(keysLimit),
    staleTime: 30 * 1000,
  })

  const createKeyMutation = useMutation({
    mutationFn: (name: string | null) => createAdminApiKey(name),
    onSuccess: (payload) => {
      setErrorMessage(null)
      setSuccessMessage('API key generated. Copy it now, it is only shown once.')
      setRevealedKey(payload.plainTextKey)
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.adminApiKeys(keysLimit),
      })
    },
  })

  const revokeKeyMutation = useMutation({
    mutationFn: (keyId: string) => revokeAdminApiKey(keyId),
    onSuccess: () => {
      setErrorMessage(null)
      setSuccessMessage('API key revoked.')
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.adminApiKeys(keysLimit),
      })
    },
  })

  const endpoints = Array.isArray(docsQuery.data?.endpoints)
    ? docsQuery.data.endpoints
    : []
  const docsSections = useMemo<AdminApiDocsSection[]>(() => {
    const sectionMap = new Map<string, AdminApiDocsSection>()
    const declaredSections = Array.isArray(docsQuery.data?.sections)
      ? docsQuery.data.sections
      : []

    for (const section of declaredSections) {
      const id = String(section.id ?? '').trim()

      if (!id) {
        continue
      }

      sectionMap.set(id, {
        id,
        title: String(section.title ?? '').trim() || 'General',
        description: String(section.description ?? '').trim() || 'General API operations.',
        endpoints: [],
      })
    }

    for (const endpoint of endpoints) {
      const sectionId = String(endpoint.section?.id ?? '').trim() || 'general'

      if (!sectionMap.has(sectionId)) {
        sectionMap.set(sectionId, {
          id: sectionId,
          title: String(endpoint.section?.title ?? '').trim() || 'General',
          description: String(endpoint.section?.description ?? '').trim() || 'General API operations.',
          endpoints: [],
        })
      }

      sectionMap.get(sectionId)?.endpoints.push(endpoint)
    }

    return [...sectionMap.values()]
      .map((section) => ({
        ...section,
        endpoints: [...section.endpoints].sort((left, right) => {
          const pathCompare = left.path.localeCompare(right.path)

          if (pathCompare !== 0) {
            return pathCompare
          }

          return left.method.localeCompare(right.method)
        }),
      }))
      .filter((section) => section.endpoints.length > 0)
      .sort((left, right) => left.title.localeCompare(right.title))
  }, [docsQuery.data?.sections, endpoints])
  const keys = Array.isArray(keysQuery.data?.keys)
    ? keysQuery.data.keys
    : []

  const combinedError = errorMessage
    || (docsQuery.error instanceof Error ? docsQuery.error.message : null)
    || (keysQuery.error instanceof Error ? keysQuery.error.message : null)
    || (createKeyMutation.error instanceof Error ? createKeyMutation.error.message : null)
    || (revokeKeyMutation.error instanceof Error ? revokeKeyMutation.error.message : null)

  const handleGenerateKey = () => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setRevealedKey(null)

    const normalizedName = newKeyName.trim()

    void createKeyMutation.mutateAsync(normalizedName || null)
      .then(() => {
        setNewKeyName('')
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : 'Could not generate API key.')
      })
  }

  const handleCopyKey = () => {
    if (!revealedKey) {
      return
    }

    void navigator.clipboard.writeText(revealedKey)
      .then(() => {
        setSuccessMessage('API key copied to clipboard.')
      })
      .catch(() => {
        setErrorMessage('Could not copy API key to clipboard.')
      })
  }

  const handleCopyBaseUrl = () => {
    const baseUrl = String(docsQuery.data?.baseUrl ?? '').trim()

    if (!baseUrl) {
      return
    }

    void navigator.clipboard.writeText(baseUrl)
      .then(() => {
        setSuccessMessage('Base URL copied to clipboard.')
      })
      .catch(() => {
        setErrorMessage('Could not copy base URL to clipboard.')
      })
  }

  const handleDownloadPdf = () => {
    if (!docsQuery.data) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsPdfExporting(true)

    void import('jspdf')
      .then(({ jsPDF }) => {
        const document = new jsPDF({ unit: 'pt', format: 'a4' })
        const margin = 42
        const pageWidth = document.internal.pageSize.getWidth()
        const pageHeight = document.internal.pageSize.getHeight()
        const maxWidth = pageWidth - margin * 2
        const lineSpacing = 4
        let y = margin

        const ensureSpace = (estimatedHeight = 16) => {
          if (y + estimatedHeight <= pageHeight - margin) {
            return
          }

          document.addPage()
          y = margin
        }

        const writeLines = (text: string, options: {
          size?: number
          bold?: boolean
          indent?: number
          spacingAfter?: number
        } = {}) => {
          const size = options.size ?? 10
          const bold = options.bold ?? false
          const indent = options.indent ?? 0
          const spacingAfter = options.spacingAfter ?? 2
          const availableWidth = Math.max(120, maxWidth - indent)
          const lines = document.splitTextToSize(String(text ?? ''), availableWidth)

          document.setFont('helvetica', bold ? 'bold' : 'normal')
          document.setFontSize(size)

          for (const line of lines) {
            ensureSpace(size + lineSpacing)
            document.text(line, margin + indent, y)
            y += size + lineSpacing
          }

          y += spacingAfter
        }

        writeLines(docsQuery.data.title, { size: 18, bold: true, spacingAfter: 8 })
        writeLines(`Base URL: ${docsQuery.data.baseUrl}`, { size: 10, spacingAfter: 4 })
        writeLines(docsQuery.data.overview, { size: 10, spacingAfter: 8 })

        writeLines('Authentication', { size: 13, bold: true, spacingAfter: 4 })
        writeLines(docsQuery.data.authentication.firebaseBearer.description, { size: 10, indent: 10 })
        writeLines(docsQuery.data.authentication.firebaseBearer.header, { size: 9, indent: 14 })
        writeLines(docsQuery.data.authentication.apiKey.description, { size: 10, indent: 10 })
        writeLines(docsQuery.data.authentication.apiKey.header, { size: 9, indent: 14 })
        writeLines(docsQuery.data.authentication.apiKey.alternativeBearer, { size: 9, indent: 14, spacingAfter: 8 })

        for (const section of docsSections) {
          ensureSpace(36)
          writeLines(section.title, { size: 14, bold: true, spacingAfter: 2 })
          writeLines(section.description, { size: 10, spacingAfter: 5 })

          for (const endpoint of section.endpoints) {
            ensureSpace(40)
            writeLines(`${endpoint.method} ${resolveEndpointUrl(docsQuery.data.baseUrl, endpoint.pathTemplate)}`, {
              size: 11,
              bold: true,
              indent: 10,
              spacingAfter: 1,
            })
            writeLines(endpoint.description, { size: 9, indent: 10, spacingAfter: 2 })

            if (endpoint.request.path.length > 0) {
              writeLines('Path Parameters', { size: 10, bold: true, indent: 14, spacingAfter: 0 })

              for (const field of endpoint.request.path) {
                writeLines(`- ${formatFieldDocumentationLine(field)}`, { size: 9, indent: 18, spacingAfter: 0 })
                const fieldDescription = formatFieldDescription(field)

                if (fieldDescription) {
                  writeLines(`  ${fieldDescription}`, { size: 8, indent: 22, spacingAfter: 0 })
                }
              }
            }

            if (endpoint.request.query.length > 0) {
              writeLines('Query Parameters', { size: 10, bold: true, indent: 14, spacingAfter: 0 })

              for (const field of endpoint.request.query) {
                writeLines(`- ${formatFieldDocumentationLine(field)}`, { size: 9, indent: 18, spacingAfter: 0 })
                const fieldDescription = formatFieldDescription(field)

                if (fieldDescription) {
                  writeLines(`  ${fieldDescription}`, { size: 8, indent: 22, spacingAfter: 0 })
                }
              }
            }

            if (endpoint.request.body.length > 0) {
              writeLines('Body Fields', { size: 10, bold: true, indent: 14, spacingAfter: 0 })

              for (const field of endpoint.request.body) {
                writeLines(`- ${formatFieldDocumentationLine(field)}`, { size: 9, indent: 18, spacingAfter: 0 })
                const fieldDescription = formatFieldDescription(field)

                if (fieldDescription) {
                  writeLines(`  ${fieldDescription}`, { size: 8, indent: 22, spacingAfter: 0 })
                }
              }
            }

            const endpointStatusCodes = endpoint.response.statusCodes.length > 0
              ? endpoint.response.statusCodes
              : endpoint.statusCodes

            writeLines(`Status Codes: ${endpointStatusCodes.join(', ') || '200'}`, {
              size: 9,
              indent: 14,
              spacingAfter: 1,
            })

            if (endpoint.response.topLevelFields.length > 0) {
              writeLines(`Response Fields: ${endpoint.response.topLevelFields.join(', ')}`, {
                size: 9,
                indent: 14,
                spacingAfter: 1,
              })
            }

            if (endpoint.errors.length > 0) {
              writeLines('Error Cases', { size: 10, bold: true, indent: 14, spacingAfter: 0 })

              for (const errorCase of endpoint.errors) {
                writeLines(`- ${errorCase.statusCode}: ${errorCase.message}`, {
                  size: 8,
                  indent: 18,
                  spacingAfter: 0,
                })
              }
            }

            writeLines('Example Request', { size: 10, bold: true, indent: 14, spacingAfter: 0 })
            writeLines(resolveExampleCurl(docsQuery.data.baseUrl, endpoint), {
              size: 8,
              indent: 18,
              spacingAfter: 4,
            })
          }
        }

        document.save('arnold-api-documentation.pdf')
        setSuccessMessage('PDF downloaded.')
      })
      .catch(() => {
        setErrorMessage('Could not generate PDF.')
      })
      .finally(() => {
        setIsPdfExporting(false)
      })
  }

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.2} alignItems="center">
            <ApiRoundedIcon color="primary" />
            <Box>
              <Typography variant="h5" fontWeight={700}>Admin API</Typography>
              <Typography color="text.secondary">
                Full endpoint documentation and admin API key management.
              </Typography>
            </Box>
          </Stack>

          <Tabs
            value={selectedTab}
            onChange={(_event, value) => {
              setSelectedTab(value as AdminApiTab)
              setErrorMessage(null)
              setSuccessMessage(null)
            }}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab value="docs" label="API DAX full documentation" icon={<ApiRoundedIcon fontSize="small" />} iconPosition="start" />
            <Tab value="keys" label="Generate key" icon={<KeyRoundedIcon fontSize="small" />} iconPosition="start" />
          </Tabs>
        </Stack>
      </Paper>

      <StatusAlerts errorMessage={combinedError} successMessage={successMessage} />

      {selectedTab === 'docs' ? (
        <Paper variant="outlined" sx={{ p: 2.25 }}>
          <Stack spacing={1.5}>
            {docsQuery.isLoading ? (
              <Typography color="text.secondary">Loading API documentation...</Typography>
            ) : (
              <>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Stack spacing={1.1}>
                    <Typography variant="h6" fontWeight={700}>Base URL</Typography>
                    <Typography fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                      {docsQuery.data?.baseUrl || '/api'}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ContentCopyRoundedIcon />}
                        onClick={handleCopyBaseUrl}
                      >
                        Copy base URL
                      </Button>

                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<PictureAsPdfRoundedIcon />}
                        onClick={handleDownloadPdf}
                        disabled={isPdfExporting}
                      >
                        {isPdfExporting ? 'Preparing PDF...' : 'Download PDF'}
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Stack spacing={1}>
                    <Typography variant="h6" fontWeight={700}>Authentication</Typography>
                    <Typography color="text.secondary">
                      {docsQuery.data?.authentication?.firebaseBearer?.description}
                    </Typography>
                    <Typography fontFamily="monospace">
                      {docsQuery.data?.authentication?.firebaseBearer?.header}
                    </Typography>
                    <Divider />
                    <Typography color="text.secondary">
                      {docsQuery.data?.authentication?.apiKey?.description}
                    </Typography>
                    <Typography fontFamily="monospace">
                      {docsQuery.data?.authentication?.apiKey?.header}
                    </Typography>
                    <Typography fontFamily="monospace">
                      {docsQuery.data?.authentication?.apiKey?.alternativeBearer}
                    </Typography>
                  </Stack>
                </Paper>

                <Alert severity="info">
                  {docsQuery.data?.overview || 'Comprehensive API reference.'}
                </Alert>

                {docsSections.map((section) => (
                  <Paper key={section.id} variant="outlined" sx={{ p: 0 }}>
                    <Box sx={{ p: 1.5 }}>
                      <Typography variant="h6" fontWeight={700}>{section.title}</Typography>
                      <Typography color="text.secondary">{section.description}</Typography>
                    </Box>

                    <Divider />

                    {section.endpoints.map((endpoint) => (
                      <Accordion key={endpoint.operationId} disableGutters>
                        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                          <Stack spacing={0.6} sx={{ width: '100%' }}>
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                              <Chip size="small" label={endpoint.method} color={methodColor(endpoint.method)} variant="outlined" />
                              <Typography fontWeight={700}>{endpoint.title}</Typography>
                            </Stack>
                            <Typography fontFamily="monospace" fontSize={13} color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                              {endpoint.pathTemplate}
                            </Typography>
                          </Stack>
                        </AccordionSummary>

                        <AccordionDetails>
                          <Stack spacing={1.25}>
                            <Typography color="text.secondary">{endpoint.description}</Typography>

                            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                              {resolveAccessTags(endpoint).map((tag) => (
                                <Chip
                                  key={`${endpoint.operationId}-${tag.label}`}
                                  size="small"
                                  label={tag.label}
                                  color={tag.color}
                                  variant={tag.variant}
                                />
                              ))}
                            </Stack>

                            {(endpoint.request.path.length > 0 || endpoint.pathParams.length > 0) ? (
                              <Box>
                                <Typography variant="subtitle2" fontWeight={700}>Path Parameters</Typography>
                                {endpoint.request.path.length > 0
                                  ? endpoint.request.path.map((field) => (
                                      <Box key={`${endpoint.operationId}-path-${field.name}`} sx={{ mb: 0.45 }}>
                                        <Typography color="text.secondary">{formatFieldDocumentationLine(field)}</Typography>
                                        {formatFieldDescription(field) ? (
                                          <Typography variant="caption" color="text.secondary">{formatFieldDescription(field)}</Typography>
                                        ) : null}
                                      </Box>
                                    ))
                                  : <Typography color="text.secondary">{endpoint.pathParams.join(', ')}</Typography>}
                              </Box>
                            ) : null}

                            {(endpoint.request.query.length > 0 || endpoint.queryParams.length > 0) ? (
                              <Box>
                                <Typography variant="subtitle2" fontWeight={700}>Query Parameters</Typography>
                                {endpoint.request.query.length > 0
                                  ? endpoint.request.query.map((field) => (
                                      <Box key={`${endpoint.operationId}-query-${field.name}`} sx={{ mb: 0.45 }}>
                                        <Typography color="text.secondary">{formatFieldDocumentationLine(field)}</Typography>
                                        {formatFieldDescription(field) ? (
                                          <Typography variant="caption" color="text.secondary">{formatFieldDescription(field)}</Typography>
                                        ) : null}
                                      </Box>
                                    ))
                                  : <Typography color="text.secondary">{endpoint.queryParams.join(', ')}</Typography>}
                              </Box>
                            ) : null}

                            {(endpoint.request.body.length > 0 || endpoint.bodyFields.length > 0) ? (
                              <Box>
                                <Typography variant="subtitle2" fontWeight={700}>Request Body Fields</Typography>
                                {endpoint.request.body.length > 0
                                  ? endpoint.request.body.map((field) => (
                                      <Box key={`${endpoint.operationId}-body-${field.name}`} sx={{ mb: 0.45 }}>
                                        <Typography color="text.secondary">{formatFieldDocumentationLine(field)}</Typography>
                                        {formatFieldDescription(field) ? (
                                          <Typography variant="caption" color="text.secondary">{formatFieldDescription(field)}</Typography>
                                        ) : null}
                                      </Box>
                                    ))
                                  : <Typography color="text.secondary">{endpoint.bodyFields.join(', ')}</Typography>}
                              </Box>
                            ) : null}

                            <Box>
                              <Typography variant="subtitle2" fontWeight={700}>Status Codes</Typography>
                              <Typography color="text.secondary">
                                {(endpoint.response.statusCodes.length > 0
                                  ? endpoint.response.statusCodes
                                  : endpoint.statusCodes
                                ).join(', ')}
                              </Typography>
                            </Box>

                            {endpoint.response.topLevelFields.length > 0 ? (
                              <Box>
                                <Typography variant="subtitle2" fontWeight={700}>Response Fields</Typography>
                                <Typography color="text.secondary">{endpoint.response.topLevelFields.join(', ')}</Typography>
                              </Box>
                            ) : null}

                            {endpoint.errors.length > 0 ? (
                              <Box>
                                <Typography variant="subtitle2" fontWeight={700}>Error Cases</Typography>
                                <Stack spacing={0.45}>
                                  {endpoint.errors.map((errorCase) => (
                                    <Typography
                                      key={`${endpoint.operationId}-error-${errorCase.statusCode}-${errorCase.message}`}
                                      color="text.secondary"
                                    >
                                      {errorCase.statusCode}: {errorCase.message}
                                    </Typography>
                                  ))}
                                </Stack>
                              </Box>
                            ) : null}

                            <Box>
                              <Typography variant="subtitle2" fontWeight={700}>Middleware</Typography>
                              <Typography color="text.secondary">{endpoint.middleware.join(', ') || 'None'}</Typography>
                            </Box>

                            <Paper variant="outlined" sx={{ p: 1.25, bgcolor: '#f8fafc' }}>
                              <Typography variant="subtitle2" fontWeight={700}>Example Request</Typography>
                              <Typography
                                component="pre"
                                fontFamily="monospace"
                                fontSize={12}
                                sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                              >
                                {resolveExampleCurl(String(docsQuery.data?.baseUrl ?? ''), endpoint)}
                              </Typography>
                            </Paper>
                          </Stack>
                        </AccordionDetails>
                      </Accordion>
                    ))}
                  </Paper>
                ))}
              </>
            )}
          </Stack>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: 2.25 }}>
          <Stack spacing={1.5}>
            <Alert severity="warning">
              Any generated API key has admin-equivalent access. Treat keys like passwords and revoke keys that are no longer needed.
            </Alert>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', md: 'center' }}>
              <TextField
                label="Key name"
                placeholder="ERP sync, BI export, Zapier, etc."
                value={newKeyName}
                onChange={(event) => setNewKeyName(event.target.value)}
                fullWidth
              />

              <Button
                variant="contained"
                startIcon={<KeyRoundedIcon />}
                onClick={handleGenerateKey}
                disabled={createKeyMutation.isPending}
              >
                {createKeyMutation.isPending ? 'Generating...' : 'Generate key'}
              </Button>
            </Stack>

            {revealedKey ? (
              <Paper variant="outlined" sx={{ p: 1.25, bgcolor: '#fffbea', borderColor: '#e6d59a' }}>
                <Stack spacing={1}>
                  <Typography fontWeight={700}>New key (shown once)</Typography>
                  <Typography fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                    {revealedKey}
                  </Typography>
                  <Box>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<ContentCopyRoundedIcon />}
                      onClick={handleCopyKey}
                    >
                      Copy key
                    </Button>
                  </Box>
                </Stack>
              </Paper>
            ) : null}

            <Typography variant="h6" fontWeight={700}>Existing keys</Typography>

            <TableContainer sx={{ maxHeight: 520, border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Key</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell>Last Used</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {keysQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography color="text.secondary">Loading API keys...</Typography>
                      </TableCell>
                    </TableRow>
                  ) : keys.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography color="text.secondary">No API keys yet.</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    keys.map((key) => {
                      const isBusy = revokeKeyMutation.isPending && revokeKeyMutation.variables === key.id

                      return (
                        <TableRow key={key.id} hover>
                          <TableCell>
                            <Typography fontFamily="monospace">{key.keyPreview || 'Hidden'}</Typography>
                          </TableCell>
                          <TableCell>{key.name || 'Untitled key'}</TableCell>
                          <TableCell>{formatDateTime(key.createdAt)}</TableCell>
                          <TableCell>{formatDateTime(key.lastUsedAt)}</TableCell>
                          <TableCell>
                            {key.isRevoked ? (
                              <Chip size="small" label="Revoked" color="default" />
                            ) : (
                              <Chip size="small" label="Active" color="success" variant="outlined" />
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              color="warning"
                              variant="outlined"
                              startIcon={<BlockRoundedIcon />}
                              disabled={key.isRevoked || isBusy}
                              onClick={() => {
                                setErrorMessage(null)
                                setSuccessMessage(null)
                                void revokeKeyMutation.mutateAsync(key.id)
                                  .catch((error: unknown) => {
                                    setErrorMessage(error instanceof Error ? error.message : 'Could not revoke key.')
                                  })
                              }}
                            >
                              {isBusy ? 'Revoking...' : 'Revoke'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        </Paper>
      )}
    </Stack>
  )
}
