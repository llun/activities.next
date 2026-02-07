import { Firestore } from '@google-cloud/firestore'

export interface FitnessSettingsDatabase {
  getFitnessSettings(actorId: string): Promise<any>
  updateFitnessSettings(actorId: string, settings: any): Promise<void>
}

export const FitnessSettingsFirestoreDatabaseMixin = (
  database: Firestore
): FitnessSettingsDatabase => ({
  async getFitnessSettings(actorId: string): Promise<any> {
    const doc = await database.collection('fitness_settings').doc(encodeURIComponent(actorId)).get()
    if (!doc.exists) return null
    return doc.data()?.settings
  },

  async updateFitnessSettings(actorId: string, settings: any): Promise<void> {
    await database.collection('fitness_settings').doc(encodeURIComponent(actorId)).set({
      actorId,
      settings,
      updatedAt: new Date()
    })
  }
})
