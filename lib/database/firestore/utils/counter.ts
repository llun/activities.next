import { FieldValue, Firestore, Transaction } from '@google-cloud/firestore'

export const getCounterValue = async (
  database: Firestore,
  key: string
): Promise<number> => {
  const doc = await database.collection('counters').doc(encodeURIComponent(key)).get()
  if (!doc.exists) return 0
  return doc.data()?.count ?? 0
}

export const increaseCounterValue = async (
  database: Firestore | Transaction,
  key: string,
  amount: number = 1
): Promise<void> => {
  const docRef = (database instanceof Firestore ? database : database['_firestore']).collection('counters').doc(encodeURIComponent(key))
  
  if (database instanceof Transaction) {
    database.set(docRef, { count: FieldValue.increment(amount) }, { merge: true })
  } else {
    await docRef.set({ count: FieldValue.increment(amount) }, { merge: true })
  }
}

export const decreaseCounterValue = async (
  database: Firestore | Transaction,
  key: string,
  amount: number = 1
): Promise<void> => {
  await increaseCounterValue(database, key, -amount)
}

export const CounterKey = {
  totalStatus: (actorId: string) => `totalStatus:${actorId}`,
  totalFollowers: (actorId: string) => `totalFollowers:${actorId}`,
  totalFollowing: (actorId: string) => `totalFollowing:${actorId}`,
  totalLike: (statusId: string) => `totalLike:${statusId}`,
  totalReblog: (statusId: string) => `totalReblog:${statusId}`,
  totalReply: (statusId: string) => `totalReply:${statusId}`
}
