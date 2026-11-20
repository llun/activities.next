/**
 * Headers every presigned upload PUT must sign.
 *
 * The presigner leaves `Content-Type` unsigned by default, so the holder of a
 * URL could store the object as `text/html` — and an object that is never
 * completed still sits in the bucket, served from the storage hostname. Signing
 * it binds the stored type to the one declared when the URL was minted.
 */
export const PRESIGNED_UPLOAD_SIGNED_HEADERS = new Set(['content-type'])
