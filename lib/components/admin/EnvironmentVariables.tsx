'use client'

import { Eye, EyeOff } from 'lucide-react'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'

interface EnvVar {
  key: string
  value: string
  isSensitive: boolean
}

interface Props {
  variables: EnvVar[]
}

export const EnvironmentVariables: FC<Props> = ({ variables }) => {
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div className="space-y-2">
      {variables.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No environment variables found
        </p>
      ) : (
        variables.map((envVar) => (
          <div
            key={envVar.key}
            className="flex items-center gap-3 rounded-xl border p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-mono font-medium truncate">
                {envVar.key}
              </p>
              <p className="text-sm font-mono text-muted-foreground truncate">
                {envVar.isSensitive && !revealedKeys.has(envVar.key)
                  ? '••••••••'
                  : envVar.value}
              </p>
            </div>
            {envVar.isSensitive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleReveal(envVar.key)}
                className="shrink-0"
              >
                {revealedKeys.has(envVar.key) ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        ))
      )}
    </div>
  )
}
