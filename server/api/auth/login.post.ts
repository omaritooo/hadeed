import { createError, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { UserRepository } from '~~/server/repositories/user.repository'
import { AuthSessionRepository } from '~~/server/repositories/auth-session.repository'
import { verifyPassword } from '~~/server/utils/password'
import { setSessionCookie } from '~~/server/utils/session-cookie'

interface LoginRequestBody {
  email?: unknown
  password?: unknown
  rememberMe?: unknown
}

// A precomputed, valid (salt:hash) pair in the same format hashPassword produces, used only to
// give the "no such user" path a scrypt call to pay for -- see the comment below.
const DUMMY_PASSWORD_HASH = '700c5e59c47b134bc71c48e4822a3244:39a7d683bad8503427942bd2ab7b1351465c9d5a61d3063d10bdc846212cd7a92bf4e2e65d5921511b3fa709195d8a5ea81b0c1552cbe14979d71b4169858901'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as LoginRequestBody
  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'email and password are required' })
  }

  const db = useDb()
  const user = await new UserRepository(db).findByEmail(body.email)

  // Same statusMessage whether the email doesn't exist or the password is wrong -- otherwise the
  // response itself would tell an attacker which emails have accounts.
  const invalidCredentials = () => createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  if (!user || !user.passwordHash) {
    // Pay the same scrypt cost as the wrong-password branch below, so response time can't be used
    // to enumerate which emails have accounts (an unconditional early return here would make the
    // no-such-user case measurably faster than the wrong-password case).
    await verifyPassword(body.password, DUMMY_PASSWORD_HASH)
    throw invalidCredentials()
  }

  const valid = await verifyPassword(body.password, user.passwordHash)
  if (!valid) throw invalidCredentials()

  const session = await new AuthSessionRepository(db).create(user.id)
  setSessionCookie(event, session.id, { persist: body.rememberMe === true })

  return { userId: user.id }
})
