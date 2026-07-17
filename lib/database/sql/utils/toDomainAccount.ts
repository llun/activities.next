import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { SQLAccount } from '@/lib/types/database/rows'
import { Account } from '@/lib/types/domain/account'

export const toDomainAccount = (row: SQLAccount): Account =>
  Account.parse({
    ...row,
    ...(row.verifiedAt != null
      ? { verifiedAt: getCompatibleTime(row.verifiedAt) }
      : null),
    ...(row.emailVerifiedAt != null
      ? { emailVerifiedAt: getCompatibleTime(row.emailVerifiedAt) }
      : null),
    ...(row.emailChangeCodeExpiresAt != null
      ? {
          emailChangeCodeExpiresAt: getCompatibleTime(
            row.emailChangeCodeExpiresAt
          )
        }
      : null),
    ...(row.passwordResetCodeExpiresAt != null
      ? {
          passwordResetCodeExpiresAt: getCompatibleTime(
            row.passwordResetCodeExpiresAt
          )
        }
      : null),
    ...(row.disabledAt != null
      ? { disabledAt: getCompatibleTime(row.disabledAt) }
      : { disabledAt: null }),
    ...(row.approvedAt != null
      ? { approvedAt: getCompatibleTime(row.approvedAt) }
      : { approvedAt: null }),
    twoFactorEnabled:
      row.twoFactorEnabled != null ? Boolean(row.twoFactorEnabled) : false,
    createdAt: getCompatibleTime(row.createdAt),
    updatedAt: getCompatibleTime(row.updatedAt)
  })
