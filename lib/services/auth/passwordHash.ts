import bcrypt from 'bcrypt'

/** bcrypt cost for every stored password hash. */
export const BCRYPT_COST = 10

export const hashPassword = (password: string): Promise<string> =>
  bcrypt.hash(password, BCRYPT_COST)

/** Reads the cost from the hash itself, so a lower-cost test hash compares too. */
export const comparePassword = (
  password: string,
  hash: string
): Promise<boolean> => bcrypt.compare(password, hash)
