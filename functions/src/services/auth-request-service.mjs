export function createAuthRequestService({
  authApprovalApproved,
  authApprovalPending,
  authClientAccessModeAppOnly,
  authClientAccessModeWebAndApp,
  authClientPlatformWeb,
  authRoleAdmin,
  authRoleStandard,
  formatAuthLoginHoursWindow,
  getAuth,
  getCollections,
  isAllowedByAuthLoginHours,
  isApprovedAdminUser,
  isReviewerLoginEmail,
  normalizeEmail,
  ownerEmail,
  resolveAuthClientPlatformFromRequest,
  toPublicAuthUser,
  extractRequestIpAddress,
  extractRequestLocalIpAddress,
  extractRequestUserAgent,
}) {
  // ---------------------------------------------------------------------------
  // Per-uid auth user cache
  // ---------------------------------------------------------------------------
  // Caches the MongoDB user document for 2 minutes so that every API request
  // doesn't need a MongoDB findOneAndUpdate roundtrip. Role/approval changes
  // made by admins propagate within the TTL window. Call invalidateAuthUserCache
  // after any admin write that changes role, approvalStatus, clientAccessMode,
  // or allowedLoginHours so the affected user picks up changes immediately.
  const _authUserCache = new Map()  // uid → { userDocument, expiresAt }
  const AUTH_USER_CACHE_TTL_MS = 2 * 60 * 1000  // 2 minutes

  function authCacheGet(uid) {
    const entry = _authUserCache.get(uid)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) { _authUserCache.delete(uid); return undefined }
    return entry.userDocument
  }

  function authCacheSet(uid, userDocument) {
    _authUserCache.set(uid, { userDocument, expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS })
  }

  function invalidateAuthUserCache(uid) {
    _authUserCache.delete(uid)
  }

  async function resolveCurrentAuthUserFromRequest(req) {
    const bearerToken = String(req.headers?.authorization ?? '').trim()

    if (!bearerToken.toLowerCase().startsWith('bearer ')) {
      throw {
        status: 401,
        message: 'Missing Firebase ID token.',
      }
    }

    const idToken = bearerToken.slice(7).trim()

    if (!idToken) {
      throw {
        status: 401,
        message: 'Missing Firebase ID token.',
      }
    }

    let decodedToken

    try {
      decodedToken = await getAuth().verifyIdToken(idToken)
    } catch {
      throw {
        status: 401,
        message: 'Invalid Firebase ID token.',
      }
    }

    const uid = String(decodedToken?.uid ?? '').trim()
    const email = String(decodedToken?.email ?? '').trim()
    const emailLower = normalizeEmail(email)

    if (!uid || !emailLower) {
      throw {
        status: 400,
        message: 'Google account email is required.',
      }
    }

    const displayName = String(decodedToken?.name ?? '').trim()
    const photoURL = String(decodedToken?.picture ?? '').trim()
    const clientPlatform = resolveAuthClientPlatformFromRequest(req)
    const requestIpAddress = extractRequestIpAddress(req)
    const requestLocalIpAddress = extractRequestLocalIpAddress(req)
    const requestUserAgent = extractRequestUserAgent(req)
    const parsedSignInAuthTime = Number(decodedToken?.auth_time)
    const signInAuthTimeSec =
      Number.isFinite(parsedSignInAuthTime) && parsedSignInAuthTime > 0
        ? Math.floor(parsedSignInAuthTime)
        : null

    // Return cached user document if still fresh. The cache stores the full
    // MongoDB document so all downstream auth checks (role, approval, login
    // hours) work exactly as before — just without the DB roundtrip.
    const cachedUserDocument = authCacheGet(uid)
    if (cachedUserDocument) {
      const cachedAuthTime = Number(cachedUserDocument?.lastLoginAuthTimeSec)
      const hasNewSignInOnCachedUser =
        signInAuthTimeSec !== null
        && (!Number.isFinite(cachedAuthTime) || signInAuthTimeSec > cachedAuthTime)

      if (!hasNewSignInOnCachedUser) {
        return { decodedToken, userDocument: cachedUserDocument }
      }
    }

    const { authUsersCollection } = await getCollections()
    const now = new Date().toISOString()
    const isOwner = emailLower === ownerEmail
    const isReviewerEmail = !isOwner && isReviewerLoginEmail(emailLower)
    const userLookupQuery = {
      $or: [
        { uid },
        { emailLower },
      ],
    }

    const existingUser = await authUsersCollection.findOne(userLookupQuery, {
      projection: {
        _id: 0,
        uid: 1,
        lastLoginAt: 1,
        lastLoginAuthTimeSec: 1,
      },
    })

    const previousSignInAuthTimeSec = Number(existingUser?.lastLoginAuthTimeSec)
    const hasNewSignIn = signInAuthTimeSec !== null
      ? !Number.isFinite(previousSignInAuthTimeSec) || signInAuthTimeSec > previousSignInAuthTimeSec
      : !String(existingUser?.lastLoginAt ?? '').trim()
    const signInAt =
      signInAuthTimeSec !== null
        ? new Date(signInAuthTimeSec * 1000).toISOString()
        : now

    const baseSetFields = {
      uid,
      email,
      emailLower,
      displayName: displayName || null,
      photoURL: photoURL || null,
      lastActivityAt: now,
      lastActivityClientPlatform: clientPlatform,
      updatedAt: now,
    }

    const updateOperation = isOwner
      ? {
          $set: {
            ...baseSetFields,
            role: authRoleAdmin,
            approvalStatus: authApprovalApproved,
            approvedAt: now,
            approvedByEmail: ownerEmail,
            clientAccessMode: authClientAccessModeWebAndApp,
          },
          $addToSet: {
            clientPlatforms: clientPlatform,
          },
          $setOnInsert: {
            createdAt: now,
          },
        }
      : isReviewerEmail
        ? {
            $set: {
              ...baseSetFields,
              role: authRoleStandard,
              approvalStatus: authApprovalApproved,
              approvedAt: now,
              approvedByEmail: ownerEmail,
              clientAccessMode: authClientAccessModeAppOnly,
            },
            $addToSet: {
              clientPlatforms: clientPlatform,
            },
            $setOnInsert: {
              createdAt: now,
            },
          }
        : {
            $set: {
              ...baseSetFields,
            },
            $addToSet: {
              clientPlatforms: clientPlatform,
            },
            $setOnInsert: {
              role: authRoleStandard,
              approvalStatus: authApprovalPending,
              clientAccessMode: authClientAccessModeWebAndApp,
              createdAt: now,
            },
          }

    if (hasNewSignIn) {
      updateOperation.$set.lastLoginAt = signInAt
      updateOperation.$set.lastLoginClientPlatform = clientPlatform
      updateOperation.$set.lastLoginUserAgent = requestUserAgent
      updateOperation.$set.lastLoginIpAddress = requestIpAddress
      updateOperation.$set.lastLoginLocalIpAddress = requestLocalIpAddress

      if (signInAuthTimeSec !== null) {
        updateOperation.$set.lastLoginAuthTimeSec = signInAuthTimeSec
      }

      updateOperation.$push = {
        signInHistory: {
          $each: [
            {
              signedInAt: signInAt,
              clientPlatform,
              ipAddress: requestIpAddress,
              localIpAddress: requestLocalIpAddress,
              userAgent: requestUserAgent,
            },
          ],
          $slice: -20,
        },
      }
    }

    const upsertResult = await authUsersCollection.findOneAndUpdate(
      userLookupQuery,
      updateOperation,
      {
        upsert: true,
        returnDocument: 'after',
        projection: {
          _id: 0,
        },
      },
    )

    if (upsertResult) {
      authCacheSet(uid, upsertResult)
    }

    return {
      decodedToken,
      userDocument: upsertResult,
    }
  }

  async function requireFirebaseAuth(req, _res, next) {
    try {
      const { decodedToken, userDocument } = await resolveCurrentAuthUserFromRequest(req)
      const publicUser = toPublicAuthUser(userDocument)
      const requestClientPlatform = resolveAuthClientPlatformFromRequest(req)

      if (!publicUser) {
        throw {
          status: 500,
          message: 'Unable to load authenticated user.',
        }
      }

      if (!publicUser.allowedClientPlatforms.includes(requestClientPlatform)) {
        throw {
          status: 403,
          message:
            requestClientPlatform === authClientPlatformWeb
              ? 'Website access is disabled for this account. Use the mobile app.'
              : 'App access is disabled for this account.',
        }
      }

      if (
        publicUser.isApproved &&
        !publicUser.isOwner &&
        !isAllowedByAuthLoginHours(userDocument)
      ) {
        throw {
          status: 403,
          message: `Access is currently blocked. You can use the app during ${formatAuthLoginHoursWindow(userDocument)}.`,
        }
      }

      req.firebaseToken = decodedToken
      req.authUser = userDocument
      req.authClientPlatform = requestClientPlatform
      next()
    } catch (error) {
      next(error)
    }
  }

  function requireAdminRole(req, _res, next) {
    if (!isApprovedAdminUser(req.authUser)) {
      return next({
        status: 403,
        message: 'Admin access is required.',
      })
    }

    next()
  }

  function requireManagerOrAdminRole(req, _res, next) {
    const publicUser = toPublicAuthUser(req.authUser)
    const hasAccess = Boolean(
      publicUser?.isApproved
      && (publicUser?.isAdmin || publicUser?.isManager),
    )

    if (!hasAccess) {
      return next({
        status: 403,
        message: 'Manager or admin access is required.',
      })
    }

    next()
  }

  function requireApprovedLinkedWorker(req, _res, next) {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved) {
      return next({
        status: 403,
        message: 'Approved access is required.',
      })
    }

    const linkedWorkerId = String(publicUser?.linkedWorkerId ?? '').trim()

    if (!linkedWorkerId) {
      return next({
        status: 403,
        message: 'Your account is not linked to a worker profile yet. Contact an admin.',
      })
    }

    req.authPublicUser = publicUser
    req.authLinkedWorkerId = linkedWorkerId
    next()
  }

  return {
    requireAdminRole,
    requireManagerOrAdminRole,
    requireApprovedLinkedWorker,
    requireFirebaseAuth,
    resolveCurrentAuthUserFromRequest,
    invalidateAuthUserCache,
  }
}
