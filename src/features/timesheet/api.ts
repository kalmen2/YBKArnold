export type TimesheetWorker = {
  id: string
  workerNumber: string | null
  fullName: string
  role: string
  email: string
  phone: string
  hourlyRate: number
  createdAt: string
  updatedAt: string
}

export type TimesheetEntry = {
  id: string
  workerId: string
  stageId?: string
  date: string
  jobName: string
  hours: number
  payRate?: number
  notes: string
  createdAt: string
}

export type TimesheetStage = {
  id: string
  name: string
  sortOrder?: number
  createdAt: string
  updatedAt: string
}

export type TimesheetMissingWorkerReview = {
  id: string
  date: string
  workerId: string
  note: string
  approved: boolean
  approvedAt?: string
  createdAt: string
  updatedAt: string
}

export type TimesheetOrderProgress = {
  id: string
  date: string
  jobName: string
  readyPercent: number
  createdAt: string
  updatedAt: string
}

type TimesheetStateResponse = {
  workers: TimesheetWorker[]
  entries: TimesheetEntry[]
  stages: TimesheetStage[]
  orderProgress?: TimesheetOrderProgress[]
  missingWorkerReviews?: TimesheetMissingWorkerReview[]
}

type CreateWorkerInput = {
  fullName: string
  role: string
  email: string
  phone: string
  hourlyRate: number
}

type UpdateWorkerInput = {
  fullName?: string
  role?: string
  email?: string
  phone?: string
  hourlyRate?: number
}

export type SyncDailyEntryRowInput = {
  entryId?: string
  workerId: string
  stageId?: string
  jobName: string
  hours: number
  notes: string
}

type UpdateEntryInput = {
  date: string
  workerId: string
  stageId?: string
  jobName: string
  hours: number
  notes: string
}

type CreateStageInput = {
  name: string
}

type UpsertMissingWorkerReviewInput = {
  date: string
  workerId: string
  note: string
  approved: boolean
}

type UpsertOrderProgressInput = {
  date: string
  jobName: string
  readyPercent: number
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error ?? 'Request failed.')
  }

  return payload as T
}

export function fetchTimesheetState() {
  return request<TimesheetStateResponse>('/api/timesheet/state')
}

export function createWorker(input: CreateWorkerInput) {
  return request<{ worker: TimesheetWorker }>('/api/timesheet/workers', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function createWorkersBulk(inputs: CreateWorkerInput[]) {
  return request<{ insertedCount: number }>('/api/timesheet/workers/bulk', {
    method: 'POST',
    body: JSON.stringify({ workers: inputs }),
  })
}

export function deleteWorker(workerId: string) {
  return request<{ ok: boolean }>(`/api/timesheet/workers/${workerId}`, {
    method: 'DELETE',
  })
}

export function updateWorker(workerId: string, input: UpdateWorkerInput) {
  return request<{ worker: TimesheetWorker }>(`/api/timesheet/workers/${workerId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function createStage(input: CreateStageInput) {
  return request<{ stage: TimesheetStage }>('/api/timesheet/stages', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteStage(stageId: string) {
  return request<{ ok: boolean }>(`/api/timesheet/stages/${stageId}`, {
    method: 'DELETE',
  })
}

export function reorderStages(stageIds: string[]) {
  return request<{ ok: boolean }>('/api/timesheet/stages/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ stageIds }),
  })
}

export function syncDailyEntries(date: string, rows: SyncDailyEntryRowInput[]) {
  return request<{
    insertedCount: number
    updatedCount: number
    deletedCount: number
  }>('/api/timesheet/entries/sync', {
    method: 'POST',
    body: JSON.stringify({ date, rows }),
  })
}

export function updateEntry(entryId: string, input: UpdateEntryInput) {
  return request<{ entry: TimesheetEntry }>(`/api/timesheet/entries/${entryId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteEntry(entryId: string) {
  return request<{ ok: boolean }>(`/api/timesheet/entries/${entryId}`, {
    method: 'DELETE',
  })
}

export function upsertMissingWorkerReview(input: UpsertMissingWorkerReviewInput) {
  return request<{ review: TimesheetMissingWorkerReview }>('/api/timesheet/missing-worker-reviews', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function upsertOrderProgress(input: UpsertOrderProgressInput) {
  return request<{ progress: TimesheetOrderProgress }>('/api/timesheet/order-progress', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}
