import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const KEY_LENGTH = 64

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, KEY_LENGTH) as Buffer
  return `${salt.toString('hex')}:${derived.toString('hex')}`
}

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false

  const derived = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH) as Buffer
  const storedHash = Buffer.from(hashHex, 'hex')
  if (derived.length !== storedHash.length) return false

  return timingSafeEqual(derived, storedHash)
}
