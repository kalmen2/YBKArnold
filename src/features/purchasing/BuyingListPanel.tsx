// The buying screen, wired up.
//
// Owns the data and the two things that change it: adding a shop purchase, and
// turning selected lines into QuickBooks purchase orders. The table itself is
// deliberately dumb, so the same list can be reused elsewhere later.
import { Alert, Snackbar, Stack } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { QUERY_KEYS } from '../../lib/queryKeys'
import {
  createPurchasingPurchaseOrders,
  createPurchasingRequest,
  fetchBuyingList,
  fetchPurchaseOrders,
  fetchPurchasingPoContext,
  fetchPurchaseOrderPdf,
  type BuyingLine,
} from './api'
import { AddPurchaseItemDialog, type NewPurchaseItem } from './AddPurchaseItemDialog'
import { BuyingListView } from './BuyingListView'
import { OrderSubitemsDialog } from './OrderSubitemsDialog'
import { PurchaseOrdersView } from './PurchaseOrdersView'
import {
  CreatePurchaseOrdersDialog,
  type PurchaseOrderDraftLine,
} from './CreatePurchaseOrdersDialog'

export function BuyingListPanel({
  canCreatePurchaseOrders,
  view,
}: {
  canCreatePurchaseOrders: boolean
  /** Which of the two screens to show; the page owns the tab. */
  view: 'buy' | 'orders'
}) {
  const queryClient = useQueryClient()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [poLines, setPoLines] = useState<BuyingLine[] | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  // Orders raised in this session, so a run of ten is still findable after the
  // toast has gone.
  const [newPurchaseOrderIds, setNewPurchaseOrderIds] = useState<string[]>([])
  const [openedLine, setOpenedLine] = useState<BuyingLine | null>(null)

  const buyingListQuery = useQuery({
    queryKey: QUERY_KEYS.purchasingBuyingList,
    queryFn: fetchBuyingList,
    staleTime: 60 * 1000,
  })

  // Only needed once a purchase order is actually being raised, so it is not
  // fetched while somebody is just reading the list.
  const poContextQuery = useQuery({
    queryKey: QUERY_KEYS.purchasingPoContext,
    queryFn: () => fetchPurchasingPoContext({ includeProjects: true }),
    // Also needed by the add dialog, which asks for a project up front.
    enabled: Boolean(poLines) || isAddOpen,
    staleTime: 10 * 60 * 1000,
  })

  const purchaseOrdersQuery = useQuery({
    queryKey: QUERY_KEYS.purchasingPurchaseOrders,
    queryFn: fetchPurchaseOrders,
    // Kept loaded even on the buying screen, so switching across after raising
    // orders shows them without a wait.
    staleTime: 60 * 1000,
  })

  const vendorNames = useMemo(
    () => [...new Set((buyingListQuery.data?.lines ?? []).map((line) => line.vendor).filter(Boolean))]
      .sort() as string[],
    [buyingListQuery.data],
  )

  const addRequest = useMutation({
    mutationFn: (item: NewPurchaseItem) => createPurchasingRequest({
      itemName: item.itemName.trim(),
      itemKey: item.itemKey,
      description: item.description.trim() || null,
      projectId: item.projectId,
      projectNumber: poContextQuery.data?.projects
        .find((project) => project.id === item.projectId)?.projectNumber ?? null,
      projectName: poContextQuery.data?.projects
        .find((project) => project.id === item.projectId)?.name ?? null,
      quantity: Number(item.quantity) || 1,
      vendor: item.vendor.trim() || null,
      source: item.source,
      orderByDate: item.orderByDate || null,
      dueDate: item.dueDate || null,
      notes: item.notes.trim() || null,
    }),
    onSuccess: async () => {
      setIsAddOpen(false)
      setSuccessMessage('Added to the buying list.')
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchasingBuyingList })
    },
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Could not add that item.')
    },
  })

  const createOrders = useMutation({
    mutationFn: async ({
      drafts,
      fallbackProjectId,
    }: {
      drafts: PurchaseOrderDraftLine[]
      fallbackProjectId: string
    }) => createPurchasingPurchaseOrders({
      // Passed per line rather than once: every part carries the project of the
      // order it belongs to, and one purchase order can span several orders.
      projectId: fallbackProjectId || undefined,
      lines: drafts.map((draft) => ({
        lineId: draft.line.lineId,
        itemName: draft.line.itemName,
        productNumber: draft.line.itemName,
        vendorId: draft.vendorId,
        projectNumber: draft.line.projectNumber ?? undefined,
        projectId: draft.line.projectId ?? undefined,
        description: [draft.line.dimensions, draft.line.description].filter(Boolean).join(' · ') || null,
        quantity: draft.line.quantity,
        unitPrice: draft.unitPrice.trim() ? Number(draft.unitPrice) : null,
      })),
    }),
    onSuccess: async (response) => {
      setPoLines(null)
      const created = response.createdItems ?? []
      setNewPurchaseOrderIds(
        response.purchaseOrders.map((order) => order.quickBooksId).filter(Boolean) as string[],
      )
      setSuccessMessage(
        created.length > 0
          ? `${response.poCount} purchase order${response.poCount === 1 ? '' : 's'} created. New QuickBooks items: ${created.map((item) => item.name).join(', ')}.`
          : `${response.poCount} purchase order${response.poCount === 1 ? '' : 's'} created. Open the Purchase orders tab to see them.`,
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchasingBuyingList }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchasingPurchaseOrders }),
      ])
    },
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create the purchase orders.')
    },
  })

  /**
   * Opened in a tab rather than downloaded: the usual reason to reach for it is
   * to read it before sending it on. The object URL is released when that tab
   * has had time to load it.
   */
  async function openPurchaseOrderPdf(purchaseOrder: { id: string, docNumber: string | null }) {
    try {
      const blob = await fetchPurchaseOrderPdf(purchaseOrder.id, purchaseOrder.docNumber)
      const objectUrl = URL.createObjectURL(blob)

      window.open(objectUrl, '_blank', 'noopener')
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not open that purchase order.')
    }
  }

  if (view === 'orders') {
    return (
      <Stack spacing={2}>
        <PurchaseOrdersView
          data={purchaseOrdersQuery.data}
          isLoading={purchaseOrdersQuery.isPending}
          isRefreshing={purchaseOrdersQuery.isFetching && !purchaseOrdersQuery.isPending}
          errorMessage={purchaseOrdersQuery.error instanceof Error ? purchaseOrdersQuery.error.message : null}
          highlightedIds={newPurchaseOrderIds}
          onRefresh={() => void purchaseOrdersQuery.refetch()}
          onOpenPdf={(purchaseOrder) => void openPurchaseOrderPdf(purchaseOrder)}
        />

        <Snackbar
          open={Boolean(errorMessage)}
          autoHideDuration={8000}
          onClose={() => setErrorMessage(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity="error" onClose={() => setErrorMessage(null)}>{errorMessage}</Alert>
        </Snackbar>
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      <BuyingListView
        data={buyingListQuery.data}
        isLoading={buyingListQuery.isPending}
        isRefreshing={buyingListQuery.isFetching && !buyingListQuery.isPending}
        errorMessage={buyingListQuery.error instanceof Error ? buyingListQuery.error.message : null}
        canCreatePurchaseOrders={canCreatePurchaseOrders}
        onRefresh={() => void buyingListQuery.refetch()}
        onAddItem={() => setIsAddOpen(true)}
        onCreatePurchaseOrders={(lines) => {
          setErrorMessage(null)
          setPoLines(lines)
        }}
        onOpenLine={setOpenedLine}
      />

      {openedLine?.orderKey ? (
        <OrderSubitemsDialog
          open
          orderKey={openedLine.orderKey}
          orderNumber={openedLine.orderNumber}
          highlightPartId={openedLine.partId ?? null}
          onOpenOrder={() => {
            window.open(
              `/orders?orderId=${encodeURIComponent(openedLine.orderNumber ?? openedLine.orderKey ?? '')}`,
              '_blank',
              'noopener',
            )
          }}
          onClose={() => setOpenedLine(null)}
        />
      ) : null}

      {isAddOpen ? (
        <AddPurchaseItemDialog
          open
          isSaving={addRequest.isPending}
          vendorOptions={vendorNames}
          projects={poContextQuery.data?.projects ?? []}
          isLoadingProjects={poContextQuery.isFetching && !poContextQuery.data}
          onSave={(item) => addRequest.mutate(item)}
          onClose={() => setIsAddOpen(false)}
        />
      ) : null}

      {poLines ? (
        <CreatePurchaseOrdersDialog
          open
          lines={poLines}
          vendors={poContextQuery.data?.vendors ?? []}
          projects={poContextQuery.data?.projects ?? []}
          isSaving={createOrders.isPending}
          errorMessage={errorMessage}
          onConfirm={(drafts, fallbackProjectId) => createOrders.mutate({ drafts, fallbackProjectId })}
          onClose={() => setPoLines(null)}
        />
      ) : null}

      <Snackbar
        open={Boolean(successMessage)}
        autoHideDuration={6000}
        onClose={() => setSuccessMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSuccessMessage(null)}>{successMessage}</Alert>
      </Snackbar>

      <Snackbar
        open={Boolean(errorMessage) && !poLines}
        autoHideDuration={8000}
        onClose={() => setErrorMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorMessage(null)}>{errorMessage}</Alert>
      </Snackbar>
    </Stack>
  )
}
