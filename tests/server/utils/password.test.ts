import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '~~/server/utils/password'

describe('password hashing', () => {
  it('round-trips: a hashed password verifies against the same plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false)
  })

  it('salts each hash differently, even for the same password', async () => {
    const hashA = await hashPassword('same password')
    const hashB = await hashPassword('same password')
    expect(hashA).not.toBe(hashB)
  })
})
