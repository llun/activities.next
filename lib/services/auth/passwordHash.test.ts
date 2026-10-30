import bcrypt from 'bcrypt'

import { comparePassword, hashPassword } from '@/lib/services/auth/passwordHash'

const PASSWORD = 'testpassword123'
const WRONG_PASSWORD = 'wrongpassword456'

describe('passwordHash', () => {
  it('round trips a password through a stored hash', async () => {
    const hash = await hashPassword(PASSWORD)
    expect(hash.startsWith('$2b$10$')).toBe(true)
    expect(await comparePassword(PASSWORD, hash)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword(PASSWORD)
    expect(await comparePassword(WRONG_PASSWORD, hash)).toBe(false)
  })

  it('compares against a lower-cost hash by reading the cost from it', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4)
    expect(hash.startsWith('$2b$04$')).toBe(true)
    expect(await comparePassword(PASSWORD, hash)).toBe(true)
  })
})
