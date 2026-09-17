// Choosing what to buy, with what happened last time in view.
//
// The catalog is built from real QuickBooks purchase history, so as soon as an
// item is picked we can say who sold it, what it cost and how long it took.
// That is the decision being made at this moment, so it belongs on this screen
// rather than two clicks away.
//
// Typing something the catalog has never seen is normal and allowed. It becomes
// a QuickBooks item only when a purchase order is raised against it.
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import {
  Autocomplete,
  Box,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { QUERY_KEYS } from '../../lib/queryKeys'
import { useDebounceValue } from '../../hooks/useDebounceValue'
import {
  fetchPurchasingItemDetail,
  fetchPurchasingItems,
  type PurchasingItemSummary,
  type PurchasingVendorBreakdown,
} from './api'

function money(value: number | null) {
  return typeof value === 'number'
    ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
    : '—'
}

/**
 * Vendors for the chosen item, best first.
 *
 * "Best" is fastest with a real price, because that is the trade the person
 * ordering is actually making. The sample count is always shown: an average of
 * one delivery is a number, not evidence.
 */
function VendorHistory({ vendors }: { vendors: PurchasingVendorBreakdown[] }) {
  const ranked = useMemo(
    () => [...vendors]
      .sort((left, right) => {
        const leftDays = left.averageShipDays ?? Number.POSITIVE_INFINITY
        const rightDays = right.averageShipDays ?? Number.POSITIVE_INFINITY

        if (leftDays !== rightDays) {
          return leftDays - rightDays
        }

        return (left.averagePrice ?? Number.POSITIVE_INFINITY) - (right.averagePrice ?? Number.POSITIVE_INFINITY)
      })
      .slice(0, 4),
    [vendors],
  )

  if (ranked.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        Never bought before. Choose the vendor yourself.
      </Typography>
    )
  }

  return (
    <Stack spacing={0.75}>
      <Typography variant="caption" color="text.secondary">Bought before from</Typography>
      {ranked.map((vendor) => (
        <Stack key={vendor.vendorKey} direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
            {vendor.vendorRaw}
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {money(vendor.averagePrice)}
          </Typography>

          {typeof vendor.averageShipDays === 'number' ? (
            <Chip
              size="small"
              variant="outlined"
              icon={<LocalShippingOutlinedIcon sx={{ fontSize: 15 }} />}
              label={`${vendor.averageShipDays}d · ${vendor.shipSampleCount}`}
              sx={{ height: 22 }}
            />
          ) : (
            <Chip size="small" variant="outlined" label="no timing" sx={{ height: 22 }} />
          )}
        </Stack>
      ))}
    </Stack>
  )
}

export function ItemHistoryPicker({
  value,
  onChange,
  label = 'Item',
  autoFocus = false,
}: {
  value: { itemKey: string | null, itemName: string }
  onChange: (next: { itemKey: string | null, itemName: string }) => void
  label?: string
  autoFocus?: boolean
}) {
  const [input, setInput] = useState(value.itemName)
  const search = useDebounceValue(input, 250)

  const itemsQuery = useQuery({
    queryKey: QUERY_KEYS.purchasingItems(search, 1, 20),
    queryFn: () => fetchPurchasingItems({ search, page: 1, pageSize: 20 }),
    staleTime: 5 * 60 * 1000,
  })

  const detailQuery = useQuery({
    queryKey: QUERY_KEYS.purchasingItemDetail(value.itemKey ?? ''),
    queryFn: () => fetchPurchasingItemDetail(value.itemKey ?? ''),
    enabled: Boolean(value.itemKey),
    staleTime: 5 * 60 * 1000,
  })

  const options = itemsQuery.data?.items ?? []

  return (
    <Stack spacing={1.5}>
      <Autocomplete
        freeSolo
        options={options}
        loading={itemsQuery.isFetching}
        inputValue={input}
        getOptionLabel={(option) => (
          typeof option === 'string' ? option : option.itemRaw
        )}
        isOptionEqualToValue={(option, selected) => option.itemKey === selected.itemKey}
        onInputChange={(_event, next, reason) => {
          setInput(next)

          // Typing by hand clears the catalog link; the name still counts.
          if (reason === 'input') {
            onChange({ itemKey: null, itemName: next })
          }
        }}
        onChange={(_event, selected) => {
          if (!selected || typeof selected === 'string') {
            onChange({ itemKey: null, itemName: String(selected ?? '') })
            return
          }

          setInput(selected.itemRaw)
          onChange({ itemKey: selected.itemKey, itemName: selected.itemRaw })
        }}
        renderOption={(props, option: PurchasingItemSummary) => (
          <Box component="li" {...props} key={option.itemKey}>
            <Stack sx={{ minWidth: 0, width: '100%' }}>
              <Typography variant="body2" noWrap>{option.itemRaw}</Typography>
              <Typography variant="caption" color="text.disabled" noWrap>
                {[
                  option.vendorCount === 1
                    ? option.vendorRaws[0]
                    : `${option.vendorCount} vendors`,
                  `${option.transactionCount} purchases`,
                ].filter(Boolean).join(' · ')}
              </Typography>
            </Stack>
          </Box>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            autoFocus={autoFocus}
            label={label}
            placeholder="Start typing; anything new is fine"
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {itemsQuery.isFetching ? <CircularProgress color="inherit" size={17} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />

      {value.itemKey ? (
        detailQuery.isFetching && !detailQuery.data ? (
          <Stack alignItems="center" sx={{ py: 1.5 }}><CircularProgress size={20} /></Stack>
        ) : (
          <Box sx={{ p: 1.5, bgcolor: 'grey.100', borderRadius: 1.5 }}>
            <VendorHistory vendors={detailQuery.data?.vendors ?? []} />
          </Box>
        )
      ) : input.trim() ? (
        <Typography variant="caption" color="text.secondary">
          Not bought before. It will be created in QuickBooks when the purchase order is raised.
        </Typography>
      ) : null}
    </Stack>
  )
}
