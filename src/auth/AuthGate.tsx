import GoogleIcon from '@mui/icons-material/Google'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState, type ReactNode } from 'react'
import { useAuth } from './useAuth'

type AuthMode = 'sign-in' | 'create-account'

export default function AuthGate({ children }: { children: ReactNode }) {
  const {
    appUser,
    isInitializing,
    isAuthenticated,
    isFirebaseConfigured,
    profileError,
    refreshProfile,
    signInWithGoogle,
    signInWithPassword,
    createAccountWithPassword,
    signOutFromApp,
  } = useAuth()

  const [authMode, setAuthMode] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const isCreateMode = authMode === 'create-account'

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
          bgcolor: '#ece8de',
          backgroundImage:
            'radial-gradient(circle at 16% 18%, rgba(20, 62, 99, 0.12), transparent 28%), radial-gradient(circle at 82% 80%, rgba(196, 145, 60, 0.16), transparent 30%), linear-gradient(180deg, #f7f3ea 0%, #ebe5d8 100%)',
          p: { xs: 2, md: 4 },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: '100%',
            maxWidth: 460,
            overflow: 'hidden',
            border: '1px solid rgba(23, 50, 77, 0.08)',
            borderRadius: 4,
            bgcolor: 'rgba(255,255,255,0.82)',
            backdropFilter: 'blur(14px)',
            boxShadow: '0 24px 70px rgba(35, 28, 18, 0.14)',
          }}
        >
          <Box sx={{ p: { xs: 3, sm: 4 }, bgcolor: 'transparent' }}>
            <Stack
              component="form"
              spacing={2.5}
              onSubmit={(event) => {
                event.preventDefault()

                if (!isFirebaseConfigured) {
                  setActionError('Firebase auth config is missing.')
                  return
                }

                if (isCreateMode) {
                  if (password.length < 6) {
                    setActionError('Password must be at least 6 characters.')
                    return
                  }

                  if (password !== confirmPassword) {
                    setActionError('Passwords do not match.')
                    return
                  }
                }

                setIsSubmitting(true)
                setActionError(null)

                const action = isCreateMode
                  ? createAccountWithPassword(email.trim(), password)
                  : signInWithPassword(email.trim(), password)

                void action
                  .catch((error: unknown) => {
                    setActionError(
                      error instanceof Error
                        ? error.message
                        : isCreateMode
                          ? 'Account creation failed.'
                          : 'Sign-in failed.',
                    )
                  })
                  .finally(() => {
                    setIsSubmitting(false)
                  })
              }}
            >
              <Typography variant="h5" fontWeight={700} textAlign="center">
                {isCreateMode ? 'Create account' : 'Sign in'}
              </Typography>

              <Stack direction="row" spacing={1}>
                <Button
                  variant={isCreateMode ? 'outlined' : 'contained'}
                  color="inherit"
                  onClick={() => {
                    setAuthMode('sign-in')
                    setActionError(null)
                  }}
                  sx={{ flex: 1, borderRadius: 999 }}
                >
                  Sign in
                </Button>
                <Button
                  variant={isCreateMode ? 'contained' : 'outlined'}
                  color="inherit"
                  onClick={() => {
                    setAuthMode('create-account')
                    setActionError(null)
                  }}
                  sx={{ flex: 1, borderRadius: 999 }}
                >
                  Create account
                </Button>
              </Stack>

              <Divider />

              {!isFirebaseConfigured ? (
                <Alert severity="warning">
                  Firebase auth config is missing. Add VITE_FIREBASE_* values to your
                  frontend environment.
                </Alert>
              ) : null}

              {profileError ? <Alert severity="warning">{profileError}</Alert> : null}

              {actionError ? <Alert severity="error">{actionError}</Alert> : null}

              {!isCreateMode ? (
                <Button
                  variant="outlined"
                  size="large"
                  startIcon={<GoogleIcon />}
                  disabled={isSubmitting || !isFirebaseConfigured}
                  onClick={() => {
                    setIsSubmitting(true)
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
                        setIsSubmitting(false)
                      })
                  }}
                  sx={{ minHeight: 48, borderRadius: 999 }}
                >
                  Continue with Google
                </Button>
              ) : null}

              {!isCreateMode ? <Divider>or</Divider> : null}

              <TextField
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSubmitting}
                fullWidth
              />

              <TextField
                label="Password"
                type="password"
                autoComplete={isCreateMode ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting}
                fullWidth
              />

              {isCreateMode ? (
                <TextField
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={isSubmitting}
                  fullWidth
                />
              ) : null}

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={isSubmitting || !isFirebaseConfigured}
                sx={{ minHeight: 48 }}
              >
                {isSubmitting
                  ? (isCreateMode ? 'Creating account...' : 'Signing in...')
                  : (isCreateMode ? 'Create account' : 'Sign in')}
              </Button>

              {isCreateMode ? (
                <Typography variant="caption" color="text.secondary" textAlign="center">
                  After account creation, access stays pending until approval is granted.
                </Typography>
              ) : null}
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
                Your account request has been received. Approval usually takes a few minutes.
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
