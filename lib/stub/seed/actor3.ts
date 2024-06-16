export const ACTOR3_ID = 'https://llun.test/users/test3'
export const ACTOR3_FOLLOWER_URL = `${ACTOR3_ID}/followers`

export const seedActor3 = {
  email: 'test3@llun.test',
  username: 'test3',
  passwordHash: 'test3password',
  domain: 'llun.test',
  publicKey:
    '-----BEGIN PUBLIC KEY-----\n' +
    'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAn33/D2yBqcVaLzoy6Alv\n' +
    'ZJROBRrlmaESpEFGAwnzwZv6YxipkUPtlO0sIVLvvGF9twn723HSVX6rakW4d7uA\n' +
    '3AspHaqsu/8Y+p3AcMLykrPZ9affa8Uu0HZBqcV/tBzO4PU1cQj3rcngT73UCWZn\n' +
    'P75HcHPr+0zQ0hcnIRTq+Epd/qhW1FfDKVkjoBPSq0kCaNTRM31ewU+3aClQ0bjJ\n' +
    'dfk3Q7nLFN5jCbgHpfVPmD8FAxQtBMVtbrcPYFko+2cOyPMwGezTPYhgI/INnMUZ\n' +
    'Nk8Lb7GfWAeyqc+0TbFb7qGOgvh80+xdrRBaW/P2VzKq/DH59w8AvDuMsNA0nZdE\n' +
    'w3abCk6eRW1hS6aQJp9nci9dE8oQIsNh8Ul5+tK4FKfT6qoSgrTSbgbYF8whPUzX\n' +
    'SVZMV1jAL0HYyYbvQzkMW49SB52zefns+CR+kuUupXQyV1tMWvzhEnMgXEWxIzkH\n' +
    '325nZVexnblyQM5T/t5HW4Yvqwc1CzUDc+9zQ+490vPwuS3m8msxgwveA6SzGxN2\n' +
    'S+6PFv82zscYeh/eO0fEO16KsFDwVFFFm62ba6OCG1WhP2wGs7k6mAftnO0pOP89\n' +
    'y5kmtS++EnYEPR6hUxkrekrVu2XKHWQ7dwuwO8om5HhfBXh8LNJd+0zLhvJ7UgbR\n' +
    'yE59to01YrJRo4BbuSoryaMCAwEAAQ==\n' +
    '-----END PUBLIC KEY-----\n',
  privateKey:
    '-----BEGIN ENCRYPTED PRIVATE KEY-----\n' +
    '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\n' +
    '-----END ENCRYPTED PRIVATE KEY-----\n',
  followersCount: 0,
  followingCount: 0
}
