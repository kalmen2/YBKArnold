export type TimesheetWorker = {
  id: string
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

type TimesheetStateResponse = {
  workers: TimesheetWorker[]
  entries: TimesheetEntry[]
  stages: TimesheetStage[]
}

type CreateWorkerInput = {
  fullName: string
  role: string
  email: string
  phone: string
  hourlyRate: number
}

type CreateEntryBulkRowInput = {
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

export function createEntriesBulk(date: string, rows: CreateEntryBulkRowInput[]) {
  return request<{ insertedCount: number }>('/api/timesheet/entries/bulk', {
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
