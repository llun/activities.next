export const GET = async () => {
  return Response.json({
    version: '2.0',
    software: {
      name: 'llun.activities',
      version: '0.1'
    },
    protocols: ['activitypub'],
    usage: {
      users: {
        total: 1,
        activeMonth: 1,
        activeHalfyear: 1
      },
      localPosts: 1
    },
    openRegistrations: false
  })
}
