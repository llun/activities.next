// Minimal HTML entity escaping for plain text that is interpolated into
// HTML-typed API fields (instance extended_description / privacy_policy /
// terms_of_service content, oEmbed html). `&` must be replaced first.
export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
