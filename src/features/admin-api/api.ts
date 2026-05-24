import { apiRequest } from '../api-client'

export type AdminApiFieldDoc = {
  name: string
  in: 'path' | 'query' | 'body'
  type: string
  required: boolean
  description: string
  enumValues: string[]
  minimum: number | string | boolean | null
  maximum: number | string | boolean | null
  defaultValue: number | string | boolean | null
}

export type AdminApiEndpointDoc = {
  operationId: string
  method: string
  path: string
  pathTemplate: string
  title: string
  summary: string
  description: string
  section: {
    id: string
    title: string
    description: string
  }
  pathParams: string[]
  queryParams: string[]
  bodyFields: string[]
  statusCodes: string[]
  request: {
    fields: AdminApiFieldDoc[]
    path: AdminApiFieldDoc[]
    query: AdminApiFieldDoc[]
    body: AdminApiFieldDoc[]
  }
  response: {
    statusCodes: string[]
    topLevelFields: string[]
  }
  errors: Array<{
    statusCode: string
    message: string
  }>
  exampleCurl: string
  middleware: string[]
  access: {
    requiresAuth: boolean
    adminOnly: boolean
    managerOrAdminOnly: boolean
    salesManagerOrAdminOnly: boolean
    approvedLinkedWorkerOnly: boolean
  }
}

export type AdminApiDocsResponse = {
  title: string
  version: string
  baseUrl: string
  overview: string
  authentication: {
    firebaseBearer: {
      header: string
      description: string
    }
    apiKey: {
      header: string
      alternativeBearer: string
      description: string
    }
  }
  sections: Array<{
    id: string
    title: string
    description: string
  }>
  endpoints: AdminApiEndpointDoc[]
}

export type AdminApiKeyRecord = {
  id: string
  name: string | null
  keyPrefix: string | null
  keyPreview: string | null
  createdAt: string | null
  updatedAt: string | null
  lastUsedAt: string | null
  lastUsedClientPlatform: string | null
  lastUsedIpAddress: string | null
  revokedAt: string | null
  isRevoked: boolean
  createdBy: {
    uid: string | null
    email: string | null
    displayName: string | null
  }
  revokedBy: {
    uid: string | null
    email: string | null
    displayName: string | null
  }
}

export type AdminApiKeysResponse = {
  generatedAt: string
  keys: AdminApiKeyRecord[]
}

export type CreateAdminApiKeyResponse = {
  key: AdminApiKeyRecord
  plainTextKey: string
}

function normalizeAdminApiFieldDoc(
  value: unknown,
  fallbackName: string,
  fallbackInput: 'path' | 'query' | 'body',
): AdminApiFieldDoc {
  const source = (value ?? {}) as Partial<AdminApiFieldDoc>

  return {
    name: String(source.name ?? fallbackName),
    in: source.in === 'path' || source.in === 'query' || source.in === 'body'
      ? source.in
      : fallbackInput,
    type: String(source.type ?? 'string'),
    required: Boolean(source.required),
    description: String(source.description ?? ''),
    enumValues: Array.isArray(source.enumValues)
      ? source.enumValues.map((entry) => String(entry))
      : [],
    minimum:
      typeof source.minimum === 'number' || typeof source.minimum === 'string' || typeof source.minimum === 'boolean'
        ? source.minimum
        : null,
    maximum:
      typeof source.maximum === 'number' || typeof source.maximum === 'string' || typeof source.maximum === 'boolean'
        ? source.maximum
        : null,
    defaultValue:
      typeof source.defaultValue === 'number' || typeof source.defaultValue === 'string' || typeof source.defaultValue === 'boolean'
        ? source.defaultValue
        : null,
  }
}

function normalizeAdminApiEndpointDoc(endpoint: AdminApiEndpointDoc): AdminApiEndpointDoc {
  const rawRequest = (endpoint as Partial<AdminApiEndpointDoc>).request
  const rawResponse = (endpoint as Partial<AdminApiEndpointDoc>).response

  const requestPath = Array.isArray(rawRequest?.path)
    ? rawRequest.path.map((field) => normalizeAdminApiFieldDoc(field, String((field as AdminApiFieldDoc | undefined)?.name ?? 'pathParam'), 'path'))
    : endpoint.pathParams.map((fieldName) => normalizeAdminApiFieldDoc(null, fieldName, 'path'))
  const requestQuery = Array.isArray(rawRequest?.query)
    ? rawRequest.query.map((field) => normalizeAdminApiFieldDoc(field, String((field as AdminApiFieldDoc | undefined)?.name ?? 'queryParam'), 'query'))
    : endpoint.queryParams.map((fieldName) => normalizeAdminApiFieldDoc(null, fieldName, 'query'))
  const requestBody = Array.isArray(rawRequest?.body)
    ? rawRequest.body.map((field) => normalizeAdminApiFieldDoc(field, String((field as AdminApiFieldDoc | undefined)?.name ?? 'bodyField'), 'body'))
    : endpoint.bodyFields.map((fieldName) => normalizeAdminApiFieldDoc(null, fieldName, 'body'))
  const requestFields = Array.isArray(rawRequest?.fields)
    ? rawRequest.fields.map((field) => normalizeAdminApiFieldDoc(field, String((field as AdminApiFieldDoc | undefined)?.name ?? 'field'), 'body'))
    : [...requestPath, ...requestQuery, ...requestBody]
  const responseStatusCodes = Array.isArray(rawResponse?.statusCodes)
    ? rawResponse.statusCodes.map((statusCode) => String(statusCode))
    : endpoint.statusCodes
  const responseTopLevelFields = Array.isArray(rawResponse?.topLevelFields)
    ? rawResponse.topLevelFields.map((fieldName) => String(fieldName))
    : []
  const errors = Array.isArray((endpoint as Partial<AdminApiEndpointDoc>).errors)
    ? (endpoint as Partial<AdminApiEndpointDoc>).errors!.map((error) => ({
        statusCode: String(error.statusCode ?? ''),
        message: String(error.message ?? ''),
      })).filter((error) => error.statusCode || error.message)
    : []

  return {
    ...endpoint,
    request: {
      fields: requestFields,
      path: requestPath,
      query: requestQuery,
      body: requestBody,
    },
    response: {
      statusCodes: responseStatusCodes,
      topLevelFields: responseTopLevelFields,
    },
    errors,
  }
}

export function fetchAdminApiDocs() {
  return apiRequest<AdminApiDocsResponse>('/api/admin/api-docs')
    .then((payload) => ({
      ...payload,
      endpoints: Array.isArray(payload.endpoints)
        ? payload.endpoints.map(normalizeAdminApiEndpointDoc)
        : [],
    }))
}

export function fetchAdminApiKeys(limit = 200) {
  return apiRequest<AdminApiKeysResponse>(`/api/admin/api-keys?limit=${Math.max(1, limit)}`)
}

export function createAdminApiKey(name: string | null = null) {
  return apiRequest<CreateAdminApiKeyResponse>('/api/admin/api-keys', {
    method: 'POST',
    body: JSON.stringify({
      name,
    }),
  })
}

export function revokeAdminApiKey(keyId: string) {
  return apiRequest<{ ok: boolean, key: AdminApiKeyRecord }>(
    `/api/admin/api-keys/${encodeURIComponent(keyId)}/revoke`,
    {
      method: 'POST',
    },
  )
}
