const SIGNATURE_KEYS = ['keyId', 'algorithm', 'headers', 'signature']

export function parse(signature: string) {
  return signature
    .split(',')
    .map((item) => item.split('='))
    .filter((item) => SIGNATURE_KEYS.includes(item[0]))
    .reduce((out, item) => ({ ...out, [item[0]]: JSON.parse(item[1]) }), {})
}
