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
import { useAuth } from './AuthContext'

export default function AuthGate({ children }: { children: ReactNode }) {
  const {
    appUser,
    isInitializing,
    isAuthenticated,
    isFirebaseConfigured,
    ownerEmail,
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
          bgcolor: 'background.default',
          p: 2,
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            width: '100%',
            maxWidth: 460,
            p: { xs: 2.5, sm: 3.5 },
          }}
        >
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h4" fontWeight={700}>
                YBK Arnold
              </Typography>
              <Typography color="text.secondary">
                Sign in with Google to continue.
              </Typography>
            </Box>

            {!isFirebaseConfigured ? (
              <Alert severity="warning">
                Firebase auth config is missing. Add VITE_FIREBASE_* values to your
                frontend environment.
              </Alert>
            ) : null}

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
              {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
            </Button>
          </Stack>
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
                Waiting for approval
              </Typography>
              <Typography color="text.secondary">
                Your account is signed in but still pending admin approval.
              </Typography>
            </Box>

            <Alert severity="info">
              Ask {ownerEmail} to approve your account as Standard or Admin.
            </Alert>

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
