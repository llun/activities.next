// ============================================================================
// Activities.next API Client Facade
// Re-exports domain-specific client modules from ./client/*
// ============================================================================

// --- Accounts & Preferences ---
export * from './client/accountPreferences'
export * from './client/accounts'
export * from './client/accountSettings'

// --- Admin ---
export * from './client/adminAccounts'
export * from './client/adminReports'
export * from './client/adminServerSettings'

// --- Announcements & Rules ---
export * from './client/announcements'
export * from './client/serverAnnouncements'
export * from './client/serverRules'

// --- Social & Statuses ---
export * from './client/collections'
export * from './client/conversations'
export * from './client/customEmojis'
export * from './client/directMessages'
export * from './client/filters'
export * from './client/lists'
export * from './client/media'
export * from './client/notifications'
export * from './client/notificationSettings'
export * from './client/passkeys'
export * from './client/search'
export * from './client/statuses'
export * from './client/tags'
export * from './client/timelines'
export * from './client/trends'

// --- Fitness & Strava ---
export * from './client/fitnessCalendar'
export * from './client/fitnessFiles'
export * from './client/fitnessGear'
export * from './client/fitnessGeneralSettings'
export * from './client/fitnessHeatmaps'
export * from './client/fitnessImports'
export * from './client/fitnessRoutes'
export * from './client/strava'

// --- HTTP & Base Utilities ---
export * from './client/http'
