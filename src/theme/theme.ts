import { createTheme } from '@mui/material/styles'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1f6feb',
    },
    background: {
      default: '#f5f7fb',
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily:
      '"Segoe UI", "Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif',
    h4: {
      fontSize: '1.65rem',
      letterSpacing: '-0.02em',
    },
  },
})

export default theme