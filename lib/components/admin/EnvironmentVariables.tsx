'use client'

import { FC } from 'react'

interface EnvVar {
  key: string
}

interface Props {
  variables: EnvVar[]
}

export const EnvironmentVariables: FC<Props> = ({ variables }) => {
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
                ••••••••
              </p>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
