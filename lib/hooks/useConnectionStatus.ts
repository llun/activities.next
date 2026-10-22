'use client'

import { useSyncExternalStore } from 'react'

import {
  ONLINE_CONNECTION_SNAPSHOT,
  getConnectionSnapshot,
  subscribeConnection
} from '@/lib/client/connection'
import type { ConnectionSnapshot } from '@/lib/client/connection'

/** The server snapshot is online, so hydration always matches. */
export const useConnectionStatus = (): ConnectionSnapshot =>
  useSyncExternalStore(
    subscribeConnection,
    getConnectionSnapshot,
    () => ONLINE_CONNECTION_SNAPSHOT
  )
