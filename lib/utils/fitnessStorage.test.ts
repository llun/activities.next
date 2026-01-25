import { getActivityEmoji } from './fitnessStorage'

describe('getActivityEmoji', () => {
  it('should return running emoji for Run activity', () => {
    expect(getActivityEmoji('Run')).toBe('🏃')
  })

  it('should return cycling emoji for Ride activity', () => {
    expect(getActivityEmoji('Ride')).toBe('🚴')
  })

  it('should return swimming emoji for Swim activity', () => {
    expect(getActivityEmoji('Swim')).toBe('🏊')
  })

  it('should return walking emoji for Walk activity', () => {
    expect(getActivityEmoji('Walk')).toBe('🚶')
  })

  it('should return hiking emoji for Hike activity', () => {
    expect(getActivityEmoji('Hike')).toBe('🥾')
  })

  it('should return chart emoji for unknown activity type', () => {
    expect(getActivityEmoji('Unknown')).toBe('📊')
  })

  it('should return chart emoji for empty string', () => {
    expect(getActivityEmoji('')).toBe('📊')
  })

  it('should return chart emoji for activity types with different casing', () => {
    expect(getActivityEmoji('run')).toBe('📊')
    expect(getActivityEmoji('RUN')).toBe('📊')
    expect(getActivityEmoji('RIDE')).toBe('📊')
  })

  it('should return chart emoji for other activity types', () => {
    expect(getActivityEmoji('Ski')).toBe('📊')
    expect(getActivityEmoji('Yoga')).toBe('📊')
    expect(getActivityEmoji('WeightTraining')).toBe('📊')
  })
})
