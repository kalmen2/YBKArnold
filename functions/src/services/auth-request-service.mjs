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
  writeAuthApiRequestLog,
  extractRequestUserAgent,
}) {
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
    const requestUserAgent = extractRequestUserAgent(req)
    const { authUsersCollection } = await getCollections()
    const now = new Date().toISOString()
    const isOwner = emailLower === ownerEmail
    const isReviewerEmail = !isOwner && isReviewerLoginEmail(emailLower)

    const updateOperation = isOwner
      ? {
          $set: {
            uid,
            email,
            emailLower,
            displayName: displayName || null,
            photoURL: photoURL || null,
            role: authRoleAdmin,
            approvalStatus: authApprovalApproved,
            approvedAt: now,
            approvedByEmail: ownerEmail,
            lastLoginAt: now,
            lastLoginClientPlatform: clientPlatform,
            lastLoginUserAgent: requestUserAgent,
            clientAccessMode: authClientAccessModeWebAndApp,
            updatedAt: now,
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
              uid,
              email,
              emailLower,
              displayName: displayName || null,
              photoURL: photoURL || null,
              role: authRoleStandard,
              approvalStatus: authApprovalApproved,
              approvedAt: now,
              approvedByEmail: ownerEmail,
              lastLoginAt: now,
              lastLoginClientPlatform: clientPlatform,
              lastLoginUserAgent: requestUserAgent,
              clientAccessMode: authClientAccessModeAppOnly,
              updatedAt: now,
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
              uid,
              email,
              emailLower,
              displayName: displayName || null,
              photoURL: photoURL || null,
              lastLoginAt: now,
              lastLoginClientPlatform: clientPlatform,
              lastLoginUserAgent: requestUserAgent,
              updatedAt: now,
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

    const upsertResult = await authUsersCollection.findOneAndUpdate(
      {
        $or: [
          { uid },
          { emailLower },
        ],
      },
      updateOperation,
      {
        upsert: true,
        returnDocument: 'after',
        projection: {
          _id: 0,
        },
      },
    )

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
      await writeAuthApiRequestLog(req, publicUser)
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
    requireApprovedLinkedWorker,
    requireFirebaseAuth,
    resolveCurrentAuthUserFromRequest,
  }
}
