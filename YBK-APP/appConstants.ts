import type { AppScreen, MetricTone } from './appTypes'

export const ORDER_TONES: MetricTone[] = [
  {
    cardBackground: '#e8f7ff',
    borderColor: '#9cd4f4',
    labelColor: '#21507a',
    valueColor: '#0a2f52',
  },
  {
    cardBackground: '#eaf6ee',
    borderColor: '#9fd8b2',
    labelColor: '#1d5f37',
    valueColor: '#0f3f24',
  },
  {
    cardBackground: '#fff4e8',
    borderColor: '#f2c999',
    labelColor: '#7a4d1f',
    valueColor: '#5b330b',
  },
  {
    cardBackground: '#fff9e8',
    borderColor: '#efd98d',
    labelColor: '#705718',
    valueColor: '#574107',
  },
  {
    cardBackground: '#ffeef1',
    borderColor: '#efb2bf',
    labelColor: '#7f2740',
    valueColor: '#5e1330',
  },
]

export const TICKET_TONES: MetricTone[] = [
  {
    cardBackground: '#f0efff',
    borderColor: '#b5b0f0',
    labelColor: '#3d2f8a',
    valueColor: '#281a66',
  },
  {
    cardBackground: '#f2fbf8',
    borderColor: '#9edcc8',
    labelColor: '#1b6850',
    valueColor: '#0f4a37',
  },
  {
    cardBackground: '#ecf4ff',
    borderColor: '#9ec1ea',
    labelColor: '#224f84',
    valueColor: '#14335d',
  },
  {
    cardBackground: '#fff5f1',
    borderColor: '#f3c1ac',
    labelColor: '#7a3f2a',
    valueColor: '#582712',
  },
  {
    cardBackground: '#eff7ee',
    borderColor: '#b4d6a8',
    labelColor: '#325f27',
    valueColor: '#1e4617',
  },
]

export const SIDEBAR_ITEMS: Array<{ id: AppScreen; shortLabel: string }> = [
  { id: 'dashboard', shortLabel: 'DB' },
  { id: 'orders', shortLabel: 'OR' },
  { id: 'pictures', shortLabel: 'PH' },
  { id: 'timesheet', shortLabel: 'TS' },
  { id: 'manager', shortLabel: 'MG' },
  { id: 'alerts', shortLabel: 'NT' },
  { id: 'settings', shortLabel: 'ST' },
]
