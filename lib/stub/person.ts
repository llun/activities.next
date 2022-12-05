interface Params {
  id: string
}
export const MockPerson = ({ id }: Params) => {
  return {
    id,
    username: new URL(id).pathname.split('/').pop(),
    url: id,

    endpoints: {
      following: `${id}/following`,
      followers: `${id}/followers`,
      inbox: `${id}/inbox`,
      outbox: `${id}/outbox`,
      sharedInbox: `https://${new URL(id).hostname}/inbox`
    },

    publicKey: 'public key',
    createdAt: Date.now()
  }
}
