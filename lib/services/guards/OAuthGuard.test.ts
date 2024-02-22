import { getTokenFromHeader } from './OAuthGuard'

describe('#getTokenFromHeader', () => {
  test('it returns token from header', () => {
    expect(getTokenFromHeader('Bearer token')).toEqual('token')
    expect(
      getTokenFromHeader(
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaWQiOiJmOGQwZDNjMC0yNWYzLTRmNTItYmIxMy1mODhhNzUxYjZjNTQiLCJzY29wZSI6InJlYWQgd3JpdGUiLCJzdWIiOiJodHRwczovL2NoYXQubGx1bi5pbi50aC91c2Vycy9tZSIsImV4cCI6MTcwODYzMzcwNywibmJmIjoxNzA4NjMwMTA3LCJpYXQiOjE3MDg2MzAxMDcsImp0aSI6IjY4MmEwOTc4NTVlNjY4MDhmZmQ0ZTlkNmIyMjg0OTE0YTlhZDk0MTQzYmNmMDkwNjQ2Y2VkZmI5Mzk2YmYwYzRlNzAzYTFlOWQ4NTQwZGMxIn0.btGNor-jWq55IL864txc73S8Dbwras8mE65KyoJDPSQ'
      )
    ).toEqual(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaWQiOiJmOGQwZDNjMC0yNWYzLTRmNTItYmIxMy1mODhhNzUxYjZjNTQiLCJzY29wZSI6InJlYWQgd3JpdGUiLCJzdWIiOiJodHRwczovL2NoYXQubGx1bi5pbi50aC91c2Vycy9tZSIsImV4cCI6MTcwODYzMzcwNywibmJmIjoxNzA4NjMwMTA3LCJpYXQiOjE3MDg2MzAxMDcsImp0aSI6IjY4MmEwOTc4NTVlNjY4MDhmZmQ0ZTlkNmIyMjg0OTE0YTlhZDk0MTQzYmNmMDkwNjQ2Y2VkZmI5Mzk2YmYwYzRlNzAzYTFlOWQ4NTQwZGMxIn0.btGNor-jWq55IL864txc73S8Dbwras8mE65KyoJDPSQ'
    )
  })

  test('it returns null if header is not a bearer token', () => {
    const token = getTokenFromHeader('Basic token')
    expect(token).toBeNull()
  })

  test('it returns null if header is empty', () => {
    const token = getTokenFromHeader('')
    expect(token).toBeNull()
  })
})
