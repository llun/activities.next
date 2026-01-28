export const getActorPerson = jest.fn().mockImplementation(({ actorId }) => {
  // Extract username from actorId URL
  const username = actorId.split('/').pop() || 'friend'
  const domain = new URL(actorId).hostname

  return Promise.resolve({
    id: actorId,
    type: 'Person',
    preferredUsername: username,
    inbox: `${actorId}/inbox`,
    outbox: `${actorId}/outbox`,
    followers: `${actorId}/followers`,
    following: `${actorId}/following`,
    endpoints: {
      sharedInbox: `https://${domain}/inbox`
    },
    publicKey: {
      id: `${actorId}#main-key`,
      owner: actorId,
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----'
    }
  })
})
