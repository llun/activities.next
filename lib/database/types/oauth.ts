// Re-export from new location for backward compatibility
export {
  OAuthDatabase,
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
