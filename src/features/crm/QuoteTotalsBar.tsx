// The one totals bar for a quote.
//
// Product, freight, discount and the net total used to be shown twice on the
// same screen — once as read-only boxes above the lines and again as a summary
// strip below them. Two places to read the same number is two places to doubt
// it, so this is the only one, used by both the add and the details dialogs.
import {
  Box,
  InputAdornment,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'

export type QuoteDiscountScope = 'products' | 'products_and_freight'

export function QuoteTotalsBar({
  productTotal,
  freightTotal,
  netTotal,
  totalLabel,
  discountPercent,
  discountScope,
  canEdit,
  onDiscountPercentChange,
  onDiscountScopeChange,
}: {
  productTotal: number
  freightTotal: number
  netTotal: number
  totalLabel: string
  discountPercent: string
  discountScope: QuoteDiscountScope
  canEdit: boolean
  onDiscountPercentChange: (value: string) => void
  onDiscountScopeChange: (value: QuoteDiscountScope) => void
}) {
  const money = (value: number) => value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return (
    // One slim line under the quote, the same weight as the toolbar above it.
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.5}
      flexWrap="wrap"
      useFlexGap
      sx={{ px: 0.5, py: 0.25 }}
    >
      <Typography variant="body2" color="text.secondary">
        {'Product '}
        <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{money(productTotal)}</Box>
      </Typography>

      <Typography variant="body2" color="text.secondary">
        {'Freight '}
        <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{money(freightTotal)}</Box>
      </Typography>

      <Box sx={{ flexGrow: 1 }} />

      <TextField
        size="small"
        label="Discount"
        value={discountPercent}
        disabled={!canEdit}
        onChange={(event) => {
          const value = event.target.value

          // Up to three digits and two decimals, never above 100.
          if (value === '' || (/^\d{0,3}(?:\.\d{0,2})?$/.test(value) && Number(value) <= 100)) {
            onDiscountPercentChange(value)
          }
        }}
        InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
        sx={{ width: 108, '& .MuiInputBase-root': { height: 32 } }}
      />

      {discountPercent ? (
        <ToggleButtonGroup
          exclusive
          size="small"
          value={discountScope}
          disabled={!canEdit}
          onChange={(_event, value: QuoteDiscountScope | null) => {
            if (value) {
              onDiscountScopeChange(value)
            }
          }}
          sx={{ '& .MuiToggleButton-root': { textTransform: 'none', py: 0.25, px: 1 } }}
        >
          <ToggleButton value="products">Products</ToggleButton>
          <ToggleButton value="products_and_freight">+ Freight</ToggleButton>
        </ToggleButtonGroup>
      ) : null}

      <Typography variant="body2" color="text.secondary">
        {`${totalLabel} `}
        <Box component="span" sx={{ fontWeight: 800, fontSize: '1.05rem', color: 'primary.main' }}>
          {money(netTotal)}
        </Box>
      </Typography>
    </Stack>
  )
}
