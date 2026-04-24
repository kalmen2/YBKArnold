import GoogleIcon from '@mui/icons-material/Google'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { useState, type ReactNode } from 'react'
import { useAuth } from './useAuth'

export default function AuthGate({ children }: { children: ReactNode }) {
  const {
    appUser,
    isInitializing,
    isAuthenticated,
    isFirebaseConfigured,
    profileError,
    refreshProfile,
    signInWithGoogle,
    signOutFromApp,
  } = useAuth()

  const [isSigningIn, setIsSigningIn] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (isInitializing) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
          p: 2,
        }}
      >
        <Paper variant="outlined" sx={{ p: 3, minWidth: 280 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <CircularProgress size={20} />
            <Typography color="text.secondary">Checking access...</Typography>
          </Stack>
        </Paper>
      </Box>
    )
  }

  if (!isAuthenticated) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#f2f6ff',
          backgroundImage:
            'radial-gradient(circle at 10% 10%, rgba(31,111,235,0.18), transparent 35%), radial-gradient(circle at 90% 85%, rgba(31,111,235,0.12), transparent 42%)',
          p: { xs: 2, md: 4 },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: '100%',
            maxWidth: 760,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.05fr 0.95fr' },
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 3,
          }}
        >
          <Box
            sx={{
              p: { xs: 3, sm: 4 },
              bgcolor: '#0f2d66',
              color: '#f3f7ff',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 2,
            }}
          >
            <Typography variant="overline" sx={{ letterSpacing: '0.14em', opacity: 0.9 }}>
              YBK ARNOLD
            </Typography>

            <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
              Integrations Hub
            </Typography>

            <Typography sx={{ opacity: 0.9 }}>
              Secure sign-in gives your team access to dashboard, support, timesheet,
              and picture workflows in one place.
            </Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Typography
                component="span"
                sx={{
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 999,
                  fontSize: 12,
                  bgcolor: 'rgba(255,255,255,0.14)',
                }}
              >
                Google Auth
              </Typography>
              <Typography
                component="span"
                sx={{
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 999,
                  fontSize: 12,
                  bgcolor: 'rgba(255,255,255,0.14)',
                }}
              >
                Role-Based Access
              </Typography>
            </Stack>
          </Box>

          <Box sx={{ p: { xs: 3, sm: 4 }, bgcolor: '#ffffff' }}>
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="h5" fontWeight={700}>
                  Sign in with Google
                </Typography>
                <Typography color="text.secondary">
                  Continue to your YBK workspace.
                </Typography>
              </Box>

              {!isFirebaseConfigured ? (
                <Alert severity="warning">
                  Firebase auth config is missing. Add VITE_FIREBASE_* values to your
                  frontend environment.
                </Alert>
              ) : null}

              {profileError ? <Alert severity="warning">{profileError}</Alert> : null}

              {actionError ? <Alert severity="error">{actionError}</Alert> : null}

              <Button
                variant="contained"
                size="large"
                startIcon={<GoogleIcon />}
                disabled={isSigningIn || !isFirebaseConfigured}
                onClick={() => {
                  setIsSigningIn(true)
                  setActionError(null)

                  void signInWithGoogle()
                    .catch((error: unknown) => {
                      setActionError(
                        error instanceof Error
                          ? error.message
                          : 'Google sign-in failed.',
                      )
                    })
                    .finally(() => {
                      setIsSigningIn(false)
                    })
                }}
              >
                {isSigningIn ? 'Signing in...' : 'Continue with Google'}
              </Button>

              <Typography variant="caption" color="text.secondary">
                New users may need admin approval before full access is granted.
              </Typography>
            </Stack>
          </Box>
        </Paper>
      </Box>
    )
  }

  if (!appUser || !appUser.isApproved) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
          p: 2,
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            width: '100%',
            maxWidth: 560,
            p: { xs: 2.5, sm: 3.5 },
          }}
        >
          <Stack spacing={2}>
            <Box>
              <Typography variant="h5" fontWeight={700}>
                Access pending
              </Typography>
              <Typography color="text.secondary">
                Please contact admin.
              </Typography>
            </Box>

            {profileError ? <Alert severity="warning">{profileError}</Alert> : null}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={() => {
                  setActionError(null)
                  void refreshProfile().catch((error: unknown) => {
                    setActionError(
                      error instanceof Error ? error.message : 'Retry failed.',
                    )
                  })
                }}
              >
                Check again
              </Button>

              <Button
                variant="text"
                color="inherit"
                startIcon={<LogoutRoundedIcon />}
                onClick={() => {
                  setActionError(null)
                  void signOutFromApp().catch((error: unknown) => {
                    setActionError(
                      error instanceof Error
                        ? error.message
                        : 'Sign out failed.',
                    )
                  })
                }}
              >
                Sign out
              </Button>
            </Stack>

            {actionError ? <Alert severity="error">{actionError}</Alert> : null}
          </Stack>
        </Paper>
      </Box>
    )
  }

  return <>{children}</>
}
