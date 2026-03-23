'use client'

import { Eye, EyeOff } from 'lucide-react'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'

interface EnvVar {
  key: string
  value: string | null
  isSensitive: boolean
}

interface Props {
  variables: EnvVar[]
  revealEnvVar: (key: string) => Promise<string | null>
}

export const EnvironmentVariables: FC<Props> = ({
  variables,
  revealEnvVar
}) => {
  const [revealedValues, setRevealedValues] = useState<
    Record<string, string | null>
  >({})
  const [loading, setLoading] = useState<Set<string>>(new Set())

  const toggleReveal = async (key: string) => {
    if (key in revealedValues) {
      setRevealedValues((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      return
    }

    setLoading((prev) => new Set(prev).add(key))
    try {
      const value = await revealEnvVar(key)
      setRevealedValues((prev) => ({ ...prev, [key]: value }))
    } finally {
      setLoading((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
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
                {envVar.isSensitive
                  ? envVar.key in revealedValues
                    ? (revealedValues[envVar.key] ?? '')
                    : '••••••••'
                  : (envVar.value ?? '')}
              </p>
            </div>
            {envVar.isSensitive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleReveal(envVar.key)}
                disabled={loading.has(envVar.key)}
                className="shrink-0"
              >
                {envVar.key in revealedValues ? (
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
