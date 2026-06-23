export type SecurityHeader = { key: string; value: string }

interface StaticSecurityHeaderOptions {
  /**
   * Omit `X-Frame-Options: DENY` so the response can be embedded in a third-party
   * `<iframe>`. Only the public `/embed/*` widget surface sets this; everything
   * else keeps framing denied. Cross-origin framing for the embed is permitted by
   * the CSP `frame-ancestors` directive instead (see getEmbedContentSecurityPolicy).
   */
  allowFraming?: boolean
}

export const getStaticSecurityHeaders = ({
  allowFraming = false
}: StaticSecurityHeaderOptions = {}): SecurityHeader[] => [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  ...(allowFraming
    ? []
    : [
        {
          key: 'X-Frame-Options',
          value: 'DENY'
        }
      ]),
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  },
  {
    key: 'Permissions-Policy',
    // The same-origin settings UI uses navigator.geolocation for optional
    // fitness privacy location setup while denying cross-origin access.
    value: 'camera=(), microphone=(), geolocation=(self)'
  }
]
