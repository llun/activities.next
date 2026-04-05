/**
 * Converts a base64url-encoded string to a Uint8Array suitable for use as
 * a VAPID applicationServerKey in PushManager.subscribe().
 */
export function urlBase64ToUint8Array(
  base64String: string
): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9\-_]*={0,2}$/.test(base64String)) {
    throw new Error('Invalid base64url string')
  }
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)))
}
