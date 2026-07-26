import { useSyncExternalStore } from 'react'

export type AppProcess = {
  id: string
  label: string
  detail: string | null
  startedAt: string
}

type StartAppProcessInput = {
  label: string
  detail?: string | null
}

let processSequence = 0
let activeProcesses: AppProcess[] = []
const processListeners = new Set<() => void>()

function emitProcessChange() {
  processListeners.forEach((listener) => listener())
}

function subscribeToProcesses(listener: () => void) {
  processListeners.add(listener)
  return () => processListeners.delete(listener)
}

function getActiveProcessesSnapshot() {
  return activeProcesses
}

export function startAppProcess(input: StartAppProcessInput) {
  processSequence += 1
  const process: AppProcess = {
    id: `process-${Date.now()}-${processSequence}`,
    label: String(input.label || 'Working').trim() || 'Working',
    detail: String(input.detail || '').trim() || null,
    startedAt: new Date().toISOString(),
  }

  activeProcesses = [...activeProcesses, process]
  emitProcessChange()

  return process.id
}

export function finishAppProcess(processId: string) {
  const nextProcesses = activeProcesses.filter((process) => process.id !== processId)

  if (nextProcesses.length === activeProcesses.length) {
    return
  }

  activeProcesses = nextProcesses
  emitProcessChange()
}

export async function runAppProcess<T>(
  input: StartAppProcessInput,
  work: () => Promise<T>,
) {
  const processId = startAppProcess(input)

  try {
    return await work()
  } finally {
    finishAppProcess(processId)
  }
}

export function useAppProcesses() {
  return useSyncExternalStore(
    subscribeToProcesses,
    getActiveProcessesSnapshot,
    getActiveProcessesSnapshot,
  )
}
