import { createContext, useContext } from 'react'

export type DiagnosticContext = Record<string, unknown> & {
  area?: string
  action?: string
  summary?: string
}

export type DiagnosticReportContextValue = {
  openDiagnosticReport: (context?: DiagnosticContext) => void
  recording: boolean
}

export const DiagnosticReportContext = createContext<DiagnosticReportContextValue>({
  openDiagnosticReport: () => undefined,
  recording: false,
})

export function useDiagnosticReport() {
  return useContext(DiagnosticReportContext)
}
