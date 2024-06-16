export const ACTOR1_ID = 'https://llun.test/users/test1'
export const ACTOR1_FOLLOWER_URL = `${ACTOR1_ID}/followers`

export const seedActor1 = {
  email: 'test1@llun.test',
  username: 'test1',
  passwordHash: 'test1password',
  domain: 'llun.test',
  publicKey:
    '-----BEGIN PUBLIC KEY-----\n' +
    'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAutolENeUnKf0BYB3DJs7\n' +
    '/+cx/FpBeZLzw6xjTy1Lc/jsDBioSH2VoNsIeB7M7sL8EaRGb0nEBZXhW+13Rsvq\n' +
    '7tTm9CqOHWhywva3qB+jfCgc4DRCTYSHEEIcwVIFc9T2MPxE9UrNG+iOnj/BvqhI\n' +
    'xL6uBJ/yl6UVLqrnd1TWUNS246IGR1Nz9ZtuSmgBo+F/6Mk0zfOqSi/Lkq8minDK\n' +
    'RasMkcIUnUtoFLFY4yD2+nKwnF35py6zVw8aRu5/nKXdriRGObCuAr3szfe2Ygqy\n' +
    'vKkRgQ5X3CjCZOvx9dg9OI9CJTg7JWbqRZZ/zyltmt5Ktu2Kz4Tre43Blophqan2\n' +
    'Sb7NiD5PtETPFmUjUM/P+xGknJ+tUSCiJoLpQXDCQWjxTjl0lXHO2pZRrJKMGimk\n' +
    '2rsvD4yDO7GKRYUj10n3gvsaBmUFY9bLofdmaLg42bKsziIAuBUZJsp1gYOJepEc\n' +
    'xXwfioCNGH+moU5Q3MU8IquUbsw2WB9ohpuR29AJdr/he3MAvXQQ0tuoviFU/YR8\n' +
    'u28IhAPc1Vi3QYm+7cKZn07pDK5+81ZTv7CXXuYsIt1Kcfdxg1WAqBgl3PPTw7JC\n' +
    '8WdwbeZpuV3EZ/VMkhV9NcNifYfs8S2pApybrOTmpgwgcFkyfcCFq8e1AmbGrCKt\n' +
    'sefTlM0gicekYaxwlzpJLaUCAwEAAQ==\n' +
    '-----END PUBLIC KEY-----\n',
  privateKey:
    '-----BEGIN ENCRYPTED PRIVATE KEY-----\n' +
    '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\n' +
    '-----END ENCRYPTED PRIVATE KEY-----\n',
  followersCount: 0,
  followingCount: 0
}
