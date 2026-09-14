// The app theme.
//
// Values come from the Minimal template — theme-config.ts for the palette,
// create-theme.ts for the 8px shape unit, custom-shadows.ts for the card
// shadow — rather than being approximated by eye. It replaces a navy-and-teal
// theme that painted the page background pale blue and laid three coloured
// radial gradients over the body. Surfaces are white now, and colour is spent
// on state and on totals rather than on the backdrop.
import { alpha, createTheme } from '@mui/material/styles'

// The template's palette carries two shades MUI does not define. Declaring them
// keeps `primary.lighter` usable from sx without casting at every call site.
declare module '@mui/material/styles' {
  interface PaletteColor { lighter: string, darker: string }
  interface SimplePaletteColorOptions { lighter?: string, darker?: string }
}

const GREY = {
  50: '#FCFDFD',
  100: '#F9FAFB',
  200: '#F4F6F8',
  300: '#DFE3E8',
  400: '#C4CDD5',
  500: '#919EAB',
  600: '#637381',
  700: '#454F5B',
  800: '#1C252E',
  900: '#141A21',
} as const

// Every translucent value in the template is built from grey 500.
const GREY_500 = GREY[500]

const CARD_SHADOW = `0 0 2px 0 ${alpha(GREY_500, 0.2)}, 0 12px 24px -4px ${alpha(GREY_500, 0.12)}`

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      lighter: '#C8FAD6',
      light: '#5BE49B',
      main: '#00A76F',
      dark: '#007867',
      darker: '#004B50',
      contrastText: '#FFFFFF',
    },
    secondary: { light: '#C684FF', main: '#8E33FF', dark: '#5119B7', contrastText: '#FFFFFF' },
    info: { light: '#61F3F3', main: '#00B8D9', dark: '#006C9C', contrastText: '#FFFFFF' },
    success: { light: '#77ED8B', main: '#22C55E', dark: '#118D57', contrastText: '#FFFFFF' },
    warning: { light: '#FFD666', main: '#FFAB00', dark: '#B76E00', contrastText: '#1C252E' },
    error: { light: '#FFAC82', main: '#FF5630', dark: '#B71D18', contrastText: '#FFFFFF' },
    grey: GREY,
    background: { default: '#FFFFFF', paper: '#FFFFFF' },
    text: { primary: GREY[800], secondary: GREY[600], disabled: GREY[500] },
    divider: alpha(GREY_500, 0.2),
    action: {
      active: GREY[600],
      hover: alpha(GREY_500, 0.08),
      selected: alpha(GREY_500, 0.16),
      disabled: alpha(GREY_500, 0.8),
      disabledBackground: alpha(GREY_500, 0.24),
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily:
      '"Public Sans", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif',
    h4: { fontSize: '1.65rem', letterSpacing: '-0.02em', fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { letterSpacing: '-0.01em', fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Plain white. The gradients that used to live here tinted every page.
        body: { backgroundColor: '#FFFFFF' },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: alpha(GREY_500, 0.16) },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 16, boxShadow: CARD_SHADOW, backgroundImage: 'none' },
      },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 16, backgroundImage: 'none' } },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { backgroundImage: 'none', borderColor: alpha(GREY_500, 0.2) },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: alpha(GREY_500, 0.2) },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: GREY[800] },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        // Square-ish, not pill-shaped. The 999px radius was part of the old look.
        root: { borderRadius: 8 },
        containedPrimary: { boxShadow: `0 8px 16px 0 ${alpha('#00A76F', 0.24)}` },
      },
    },
    MuiChip: {
      styleOverrides: { sizeSmall: { borderRadius: 8 }, sizeMedium: { borderRadius: 10 } },
    },
    MuiToggleButton: {
      styleOverrides: { root: { borderRadius: 8, textTransform: 'none' } },
    },
    MuiTableHead: {
      styleOverrides: {
        root: { backgroundColor: GREY[200], color: GREY[600] },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { minHeight: 44, fontWeight: 700 },
      },
    },
  },
})

export default theme
