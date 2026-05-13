import { getJobMessage } from './getJobMessage'

const verifiedSenderActorId = 'https://remote.test/users/alice'

describe('getJobMessage', () => {
  it('rejects Create Note activities without object actor attribution when the sender is verified', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/create-no-attribution',
        type: 'Create',
        actor: verifiedSenderActorId,
        object: {
          id: 'https://remote.test/users/alice/statuses/1',
          type: 'Note',
          content: 'Missing attribution'
        }
      } as never,
      verifiedSenderActorId
    )

    expect(result).toBeNull()
  })

  it.each([
    ['Update', 'Update', 'https://remote.test/users/alice#main-key'],
    ['Announce', 'Announce', 'https://remote.test/users/alice#main-key'],
    ['Delete', 'Delete', 'https://remote.test/users/alice#main-key']
  ])(
    'attaches the normalized verified sender actor id to %s job messages',
    (_label, type, senderActorId) => {
      const object =
        type === 'Update'
          ? {
              id: 'https://remote.test/users/alice/statuses/1',
              type: 'Note',
              attributedTo: verifiedSenderActorId,
              content: 'Updated content'
            }
          : 'https://remote.test/users/alice/statuses/1'

      const result = getJobMessage(
        {
          id: `https://remote.test/activities/${type.toLowerCase()}-1`,
          type,
          actor: verifiedSenderActorId,
          object
        } as never,
        senderActorId
      )

      expect(result).toMatchObject({
        verifiedSenderActorId: verifiedSenderActorId.toLowerCase()
      })
    }
  )

  it('rejects Update Note activities when object attribution differs from the verified sender', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/update-spoofed',
        type: 'Update',
        actor: verifiedSenderActorId,
        object: {
          id: 'https://remote.test/users/mallory/statuses/1',
          type: 'Note',
          attributedTo: 'https://remote.test/users/mallory',
          content: 'Spoofed content'
        }
      } as never,
      verifiedSenderActorId
    )

    expect(result).toBeNull()
  })

  it('rejects Announce activities when the activity actor differs from the verified sender', () => {
    const result = getJobMessage(
      {
        id: 'https://remote.test/activities/announce-spoofed',
        type: 'Announce',
        actor: 'https://remote.test/users/mallory',
        object: 'https://remote.test/users/alice/statuses/1'
      } as never,
      verifiedSenderActorId
    )

    expect(result).toBeNull()
  })
})
