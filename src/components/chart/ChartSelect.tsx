import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import { ButtonBase, Menu, MenuItem } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'

export type ChartSelectOption = {
  value: string
  label: string
}

type ChartSelectProps = {
  options: ChartSelectOption[]
  value: string
  onChange: (newValue: string) => void
  disabled?: boolean
}

export function ChartSelect({ options, value, onChange, disabled = false }: ChartSelectProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const open = Boolean(anchorEl)
  const activeLabel = options.find((option) => option.value === value)?.label ?? value

  return (
    <>
      <ButtonBase
        onClick={(event) => setAnchorEl(event.currentTarget)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        sx={(theme) => ({
          pr: 1,
          pl: 1.5,
          gap: 1,
          height: 34,
          borderRadius: 1,
          typography: 'subtitle2',
          color: 'text.primary',
          border: `solid 1px ${alpha(theme.palette.text.primary, 0.16)}`,
          '&.Mui-disabled': { opacity: 0.5 },
        })}
      >
        {activeLabel}
        {open
          ? <KeyboardArrowUpRoundedIcon sx={{ fontSize: 18 }} />
          : <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18 }} />}
      </ButtonBase>

      <Menu anchorEl={anchorEl} open={open} onClose={() => setAnchorEl(null)}>
        {options.map((option) => (
          <MenuItem
            key={option.value}
            selected={option.value === value}
            onClick={() => {
              setAnchorEl(null)
              onChange(option.value)
            }}
          >
            {option.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
