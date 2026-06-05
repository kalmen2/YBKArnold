import { alpha, createTheme } from '@mui/material/styles'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      light: '#74a8ff',
      main: '#1f6feb',
      dark: '#0b4cae',
      contrastText: '#ffffff',
    },
    secondary: {
      light: '#55d6c9',
      main: '#1ba89a',
      dark: '#0d6f66',
      contrastText: '#ffffff',
    },
    background: {
      default: '#edf3ff',
      paper: '#ffffff',
    },
    text: {
      primary: '#10243d',
      secondary: '#4b6179',
    },
    divider: alpha('#10243d', 0.12),
  },
  shape: {
    borderRadius: 14,
  },
  typography: {
    fontFamily:
      '"Avenir Next", "Segoe UI", "Trebuchet MS", "Helvetica Neue", Helvetica, Arial, sans-serif',
    h4: {
      fontSize: '1.65rem',
      letterSpacing: '-0.02em',
    },
    h6: {
      letterSpacing: '-0.01em',
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
      letterSpacing: '0.01em',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#edf3ff',
          backgroundImage: [
            'radial-gradient(circle at 9% -8%, rgba(31,111,235,0.16) 0%, rgba(31,111,235,0) 34%)',
            'radial-gradient(circle at 92% 0%, rgba(27,168,154,0.15) 0%, rgba(27,168,154,0) 32%)',
            'linear-gradient(180deg, #f4f8ff 0%, #f8fbff 45%, #f3faf7 100%)',
          ].join(', '),
          backgroundAttachment: 'fixed',
        },
      },
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: ({ theme }) => ({
          borderColor: alpha(theme.palette.primary.main, 0.09),
          borderWidth: 1,
          borderStyle: 'solid',
          backgroundImage: 'none',
          boxShadow: `0 8px 22px ${alpha(theme.palette.primary.dark, 0.05)}`,
        }),
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundImage: 'none',
          borderColor: alpha(theme.palette.primary.main, 0.1),
        }),
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: alpha(theme.palette.background.paper, 0.82),
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: alpha(theme.palette.primary.main, 0.38),
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderWidth: 2,
          },
        }),
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          paddingLeft: 14,
          paddingRight: 14,
        },
        containedPrimary: {
          boxShadow: '0 10px 20px rgba(31,111,235,0.24)',
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: alpha(theme.palette.primary.main, 0.06),
        }),
      },
    },
    MuiTab: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 10,
          minHeight: 38,
          transition: theme.transitions.create(['background-color', 'color'], {
            duration: theme.transitions.duration.shorter,
          }),
          '&.Mui-selected': {
            backgroundColor: alpha(theme.palette.primary.main, 0.12),
          },
        }),
      },
    },
  },
})

export default theme