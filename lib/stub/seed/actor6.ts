// Actor without following, followers, and statuses
export const ACTOR6_ID = 'https://llun.test/users/test6'
export const ACTOR6_FOLLOWER_URL = `${ACTOR6_ID}/followers`

export const seedActor6 = {
  email: 'test6@llun.test',
  username: 'test6',
  passwordHash: 'test6password',
  domain: 'llun.test',
  publicKey:
    '-----BEGIN PUBLIC KEY-----\n' +
    'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEArNQZGtf4ix/HPpgaiot3\n' +
    'KQgQQZmgvN2NiXiD+qHnn9nhQMzl8n/o5bFLUAeZiStEl7SZWqxOsC+5h4Yf0OOX\n' +
    'wXz4mnyESlwA5bCCOVDIMck/lxtM3jee7A0FDJSsA7pXRy1XSgMXNp3QCm1L1hrk\n' +
    'IlqYB2q+ounEtF5FeiK/dGZp5eOCVS3Yr+ZG2YDy9qMk2et3+hWonEri3baRjLrp\n' +
    '03LuSmMZVs2Yjm95BhUffPL8BCQvGrDUmd1UaNxmpfqzVaO9ETeXahu969ClinFJ\n' +
    'X2Wb4js1IMMxzKo4+MiefDGiV1OPdp6G4lrGCdgiFT4vYQBdbUJEZoScJSEGPNQ7\n' +
    'hGzzK1GZDlAwXd4PpflNQqxDeZj4yklUXALKzrumULwAmA7iud2cVkWeIcxpTe9Y\n' +
    'cn42AJlTu/QnJm0O2rDhMIDDEj9wGFKE/h9SzvkkLCpYJ1zo1Oslo2XRm2sdcZlh\n' +
    'MH/zSM4ub52ingYOc6UpD677eZebrN6Byo8pxNRRsSX+SpXSEJdQ2lFh2mOygB5h\n' +
    '4Te37WSlmZAXEYSwIGRupzwfwxZJv8haRuIEF69NLyvJg6XuP/0OXtm+AXfDaQqE\n' +
    'dqChuMuzcHY5/LCx0xjLmaDbx7o3lQaxSdDx1CUQwymYnDNYOrmAx6RNqkboK0YN\n' +
    'jXyyQbOUT+V2QsEfsopLNWsCAwEAAQ==\n' +
    '-----END PUBLIC KEY-----\n',
  privateKey:
    '-----BEGIN ENCRYPTED PRIVATE KEY-----\n' +
    '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\n' +
    '-----END ENCRYPTED PRIVATE KEY-----\n',
  followersCount: 0,
  followingCount: 0
}
