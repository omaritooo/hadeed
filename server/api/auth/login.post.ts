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
  if (!user || !user.passwordHash) throw invalidCredentials()

  const valid = await verifyPassword(body.password, user.passwordHash)
  if (!valid) throw invalidCredentials()

  const session = await new AuthSessionRepository(db).create(user.id)
  setSessionCookie(event, session.id, { persist: body.rememberMe === true })

  return { userId: user.id }
})
