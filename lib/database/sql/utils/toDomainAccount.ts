import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { SQLAccount } from '@/lib/types/database/rows'
import { Account } from '@/lib/types/domain/account'

export const toDomainAccount = (row: SQLAccount): Account =>
  Account.parse({
    ...row,
    ...(row.verifiedAt
      ? { verifiedAt: getCompatibleTime(row.verifiedAt) }
      : null),
    ...(row.emailVerifiedAt
      ? { emailVerifiedAt: getCompatibleTime(row.emailVerifiedAt) }
      : null),
    ...(row.emailChangeCodeExpiresAt
      ? {
          emailChangeCodeExpiresAt: getCompatibleTime(
            row.emailChangeCodeExpiresAt
          )
        }
      : null),
    ...(row.passwordResetCodeExpiresAt
      ? {
          passwordResetCodeExpiresAt: getCompatibleTime(
            row.passwordResetCodeExpiresAt
          )
        }
      : null),
    createdAt: getCompatibleTime(row.createdAt),
    updatedAt: getCompatibleTime(row.updatedAt)
  })
