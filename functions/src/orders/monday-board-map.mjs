// Exact Monday.com board and column IDs for every board the website syncs.
//
// This replaces runtime column-title guessing: every column the website reads
// or writes is a named constant here, verified against the live boards on
// 2026-07-08. If Monday's board structure changes, update this file — the
// sync fails loudly on unknown columns instead of quietly misreading data.
//
// CAUTION — the same column ID means DIFFERENT things on different boards
// (e.g. status16 is "Base/Form" on Order Track but "Sanding" on Shipped).
// Never share column IDs across boards; always go through the board's map.
//
// This module is deliberately the only place Monday board structure lives, so
// removing Monday later means deleting this file and the adapter that uses it.

const ORDER_TRACK_BOARD_ID = '1062951447'
const DESIGN_BOARD_ID = '1064270065'
const SHIPPED_BOARD_ID = '1072680042'

// Financial source boards used only to enrich the unified Orders records.
// They are matched by ACK, never by the mutable Monday board name.
export const NEW_ORDERS_FINANCIAL_BOARDS_BY_PREFIX = Object.freeze({
  24: Object.freeze({
    year: 2024,
    boardId: '5770735058',
    ackColumnId: 'text9',
    orderValueColumnId: 'numbers',
    freightValueColumnId: 'numbers5',
    depositReceivedColumnId: 'date2',
    salesRepColumnId: null,
  }),
  25: Object.freeze({
    year: 2025,
    boardId: '8142996505',
    ackColumnId: 'text9',
    orderValueColumnId: 'numbers',
    freightValueColumnId: 'numbers5',
    depositReceivedColumnId: 'date2',
    salesRepColumnId: null,
  }),
  26: Object.freeze({
    year: 2026,
    boardId: '18393945685',
    ackColumnId: 'text9',
    orderValueColumnId: 'numbers',
    freightValueColumnId: 'numbers5',
    depositReceivedColumnId: 'date2',
    salesRepColumnId: 'text_mm3x9wep',
  }),
})

// --- Order Track AKF (production working set) ------------------------------
const orderTrackColumns = Object.freeze({
  ackNumber: 'text9', // "ACK" — the order number (YYMM##)
  progress: 'progress',
  notes: 'text_mkpymfhb',
  priority: 'color_mkwttx78',
  outsources: 'text_mkwkstv2',
  leadTime: 'due_date', // date — production due date
  poDate: 'date7', // order date
  description: 'text81',
  people: 'people',
  shopDrawings: 'files',
  stageDesign: 'status',
  stageBaseForm: 'status16',
  stageBuild: 'status5',
  stageSandOrLam: 'dup__of_sanding',
  stageSealer: 'status0',
  stageLacquer: 'status6',
  stageReady: 'status3',
  bench: 'text4', // who builds it
  poNumber: 'text2',
  shipTo: 'location',
  shipMethod: 'ship', // dropdown: "Dock Delivery (Blanket Wrapped)", "Non-Union D&I", ...
  shipNotes: 'text95',
  bol: 'files6',
  shipDate: 'date1',
  invoiced: 'status7', // "Deposit Received" / "Done" / "Paid in Full"
  cbd: 'text6', // "CBD" / "PIF"
  cutList: 'file', // Parts/Board Summary + Pattern Preview PDFs
  pictures: 'file_mm1sbyhj',
})

// --- Design AKF (pre-production) -------------------------------------------
const designColumns = Object.freeze({
  ackNumber: 'text9',
  stageDesign: 'status',
  leadTime: 'due_date',
  poDate: 'date',
  poNumber: 'text2',
  description: 'text81',
  people: 'people',
  shopDrawings: 'files',
  wood: 'text99',
  tCounter: 'text7',
  material: 'text25',
  bench: 'text4',
  metal: 'text8',
  upholstery: 'text40',
  stageBuild: 'status5',
  stageSanding: 'status16', // NOTE: "Sanding" here, "Base/Form" on Order Track
  stageSealer: 'status0',
  stageLacquer: 'status6',
  stageReady: 'status3',
  shipTo: 'location',
  shipStatus: 'status1', // status here, dropdown on Order Track
  progress: 'progress',
  notes: 'text95',
  bol: 'files5',
  shipDate: 'date0',
})

// --- Shipped Orders AKF ------------------------------------------------------
const shippedColumns = Object.freeze({
  ackNumber: 'text9',
  shopDrawings: 'files',
  leadTime: 'due_date',
  poDate: 'date7',
  poNumber: 'text2',
  description: 'text81',
  people: 'people',
  stageDesign: 'status',
  wood: 'text99',
  tCounter: 'text7',
  specialMaterial: 'text25',
  bench: 'text4',
  metal: 'text8',
  upholstery: 'text40',
  stageBaseForm: 'base_form',
  stageBuild: 'status5',
  stageSanding: 'status16', // NOTE: "Sanding" here, "Base/Form" on Order Track
  stageSealer: 'status0',
  stageLacquer: 'status6',
  stageReady: 'status3',
  shipTo: 'location',
  shipMethod: 'ship',
  progress: 'progress',
  notes: 'text95',
  bol: 'files6',
  shipDate: 'date1',
  invoiced: 'invoiced',
  cbd: 'cbd',
  pictures: 'file_mm2tzp5k',
})

export const MONDAY_BOARDS = Object.freeze({
  orderTrack: Object.freeze({
    id: ORDER_TRACK_BOARD_ID,
    name: 'Order Track AKF',
    columns: orderTrackColumns,
  }),
  design: Object.freeze({
    id: DESIGN_BOARD_ID,
    name: 'Design AKF',
    columns: designColumns,
  }),
  shipped: Object.freeze({
    id: SHIPPED_BOARD_ID,
    name: 'Shipped Orders AKF',
    columns: shippedColumns,
  }),
})

// Website-owned fields that must NEVER be overwritten from Monday. Customer
// documents and order-change state live only in Firebase Storage + Mongo.
export const WEBSITE_OWNED_ORDER_FIELDS = Object.freeze([
  'signed_bol',
  'Signed_BOL_source',
  'Signed_BOL',
  'customer_signed_bol',
  'Customer_Signed_BOL_source',
  'Customer_Signed_BOL',
  'customer_signed_bol_required',
  'customer_signed_bol_requirement_grandfathered_at',
  'change_version',
  'change_order_status',
  'change_order_url',
  'change_order_name',
  'change_order_history',
  'pending_order_change',
  'customer_signed_change_order',
  'customer_signed_change_order_url',
  'Customer_Signed_Change_Order',
  'customer_signed_change_order_uploaded_at',
  'inspection_sheet',
  'Inspection_sheet_source',
  'Inspection_sheet',
  'invoice_pdf_cached_url',
  'invoice_pdf_file_name',
  'warranty_issue_active',
  'warranty_issue_description',
  'warranty_issue_reported_at',
  'warranty_issue_lead_time_date',
  'warranty_issue_done_at',
  'parent_order_number',
  'is_warranty_order',
  'warranty_parent_order_number',
  'archived_at',
  'archived_by_uid',
  'archived_by_email',
  'design_parts',
  'production_handoff_status',
  'production_handoff_requested_at',
  'production_handoff_requested_by_uid',
  'production_handoff_requested_by_email',
  'production_handoff_confirmations',
  'production_handoff_approved_at',
  'production_handoff_approved_by_uid',
  'production_handoff_approved_by_email',
])

export function resolveBoardMapById(boardId) {
  const normalized = String(boardId ?? '').trim()

  if (!normalized) {
    return null
  }

  return Object.values(MONDAY_BOARDS).find((board) => board.id === normalized) ?? null
}

// Builds the column-detection object the Monday snapshot service consumes,
// from this board map instead of keyword-guessing column titles at runtime.
// Env-var column overrides still win, matching the old detection behavior.
// Returns null when the board is not mapped (caller decides how to fail).
export function buildDetectedColumnsForBoard(boardId, columnOverrides = {}) {
  const board = resolveBoardMapById(boardId)

  if (!board) {
    return null
  }

  const columns = board.columns
  const override = (value) => {
    const normalized = String(value ?? '').trim()
    return normalized || null
  }

  // Keys and weights mirror the snapshot service's progress-status config;
  // "Invoiced" rides along as an extra tracked status column where a board
  // has one. Boards without a stage column simply omit that entry.
  const progressStatusColumns = [
    { key: 'design', label: 'Design', weight: 13, columnId: columns.stageDesign ?? null },
    { key: 'baseForm', label: 'Base/Form', weight: 13, columnId: columns.stageBaseForm ?? null },
    { key: 'build', label: 'Build', weight: 13, columnId: columns.stageBuild ?? null },
    {
      key: 'sandOrLam',
      label: 'Sand or lam',
      weight: 13,
      columnId: columns.stageSandOrLam ?? columns.stageSanding ?? null,
    },
    { key: 'sealer', label: 'Sealer', weight: 12, columnId: columns.stageSealer ?? null },
    { key: 'lacquer', label: 'Lacquer', weight: 12, columnId: columns.stageLacquer ?? null },
    { key: 'ready', label: 'Ready', weight: 12, columnId: columns.stageReady ?? null },
    { key: 'invoiced', label: 'Invoiced', weight: 12, columnId: columns.invoiced ?? null },
  ].filter((entry) => Boolean(entry.columnId))

  return {
    statusColumnId: columns.stageDesign ?? null,
    shipDateColumnId: override(columnOverrides.shipDateColumnId) || columns.shipDate || null,
    leadTimeColumnId: override(columnOverrides.leadTimeColumnId) || columns.leadTime || null,
    dueDateColumnId: override(columnOverrides.dueDateColumnId) || columns.leadTime || null,
    shopDrawingColumnId: columns.shopDrawings ?? null,
    cutListColumnId: columns.cutList ?? null,
    shipToColumnId: columns.shipTo ?? null,
    shipNotesColumnId: columns.shipNotes ?? null,
    bolColumnId: columns.bol ?? null,
    // Driver Signed BOL, Customer Signed BOL, and inspection sheet are
    // website-owned documents; they have
    // no Monday columns and must never be read from Monday.
    signedBolColumnId: null,
    inspectionSheetColumnId: null,
    poNumberColumnId: override(columnOverrides.poNumberColumnId) || columns.poNumber || null,
    benchColumnId: columns.bench ?? null,
    notesColumnId: columns.notes ?? null,
    descriptionColumnId: override(columnOverrides.descriptionColumnId) || columns.description || null,
    orderDateColumnId: override(columnOverrides.orderDateColumnId) || columns.poDate || null,
    progressColumnId: columns.progress ?? null,
    progressStatusColumns,
    ackColumnId: columns.ackNumber ?? null,
  }
}
