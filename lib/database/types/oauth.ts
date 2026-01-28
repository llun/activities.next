// Re-export from new location for backward compatibility
// Zod schemas (values)
export {
  Scope,
  UsableScopes,
  GrantIdentifiers,
  CreateClientParams,
  GetClientFromNameParams,
  GetClientFromIdParams,
  UpdateClientParams,
  GetAccessTokenParams,
  GetAccessTokenByRefreshTokenParams,
  CreateAccessTokenParams,
  UpdateRefreshTokenParams,
  RevokeAccessTokenParams,
  TouchAccessTokenParams,
  CreateAuthCodeParams,
  GetAuthCodeParams,
  RevokeAuthCodeParams
} from '@/lib/types/database/operations'

// Type-only exports
export type { OAuthDatabase } from '@/lib/types/database/operations'
