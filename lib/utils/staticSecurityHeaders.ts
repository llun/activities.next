export type SecurityHeader = { key: string; value: string }

export const getStaticSecurityHeaders = (): SecurityHeader[] => [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY'
  },
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
