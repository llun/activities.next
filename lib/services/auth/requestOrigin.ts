import { buildBaseURL } from '@/lib/config'
import { type HostHeaders, selectHeaderHost } from '@/lib/utils/host'

type AuthHostConfig = {
  host: string
  trustedHosts?: readonly string[] | null
}

// Resolve the base URL the auth instance should use for an incoming request.
//
// Passkeys are scoped to a WebAuthn Relying Party ID, which is the host the
// ceremony runs against. To support a deployment serving several domains
// (ACTIVITIES_HOST plus ACTIVITIES_TRUSTED_HOSTS), each request must use the
// rpID/origin of the host it actually arrived on so the browser offers and
// verifies the passkeys registered for that domain. `selectHeaderHost` already
// resolves the request host against the trusted-host allowlist (falling back to
// the configured host for anything untrusted), so an attacker cannot steer the
// rpID to a host we do not serve.
export const resolveAuthBaseURL = (
  headers: HostHeaders,
  config: AuthHostConfig
): string => {
  const host = selectHeaderHost(headers, {
    host: config.host,
    trustedHosts: config.trustedHosts ?? null
  })
  return buildBaseURL(host)
}
