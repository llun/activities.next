import { getMoveActivity } from '@/lib/activities/move'

describe('getMoveActivity', () => {
  it('builds the Mastodon MoveSerializer activity', () => {
    expect(
      getMoveActivity({
        migrationId: 'm1',
        originActorId: 'https://llun.test/users/test1',
        targetActorId: 'https://newhome.test/users/test1'
      })
    ).toEqual({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://llun.test/users/test1#moves/m1',
      type: 'Move',
      actor: 'https://llun.test/users/test1',
      object: 'https://llun.test/users/test1',
      target: 'https://newhome.test/users/test1'
    })
  })
})
