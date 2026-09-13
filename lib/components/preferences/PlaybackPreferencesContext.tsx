'use client'

import {
  FC,
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'

export interface PlaybackPreferencesContextValue {
  autoplayGifs: boolean
  setAutoplayGifs: (enabled: boolean) => void
}

const DEFAULT_PREFERENCES: PlaybackPreferencesContextValue = {
  autoplayGifs: false,
  setAutoplayGifs: () => {}
}

export const PlaybackPreferencesContext =
  createContext<PlaybackPreferencesContextValue>(DEFAULT_PREFERENCES)

export interface PlaybackPreferencesProviderProps {
  actorId?: string | null
  initialAutoplayGifs?: boolean
  children: ReactNode
}

export const PlaybackPreferencesProvider: FC<
  PlaybackPreferencesProviderProps
> = ({ actorId, initialAutoplayGifs = false, children }) => {
  const [autoplayGifs, setAutoplayGifs] = useState(initialAutoplayGifs)

  useEffect(() => {
    setAutoplayGifs(initialAutoplayGifs)
  }, [actorId, initialAutoplayGifs])

  const value = useMemo(
    () => ({
      autoplayGifs,
      setAutoplayGifs
    }),
    [autoplayGifs]
  )

  return (
    <PlaybackPreferencesContext.Provider value={value}>
      {children}
    </PlaybackPreferencesContext.Provider>
  )
}

export const usePlaybackPreferences = () =>
  useContext(PlaybackPreferencesContext)
