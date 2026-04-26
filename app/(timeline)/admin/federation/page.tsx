import { Download, ShieldBan, ShieldCheck, Trash2 } from 'lucide-react'
import { redirect } from 'next/navigation'

import {
  createDomainAllowAction,
  createDomainBlockAction,
  deleteDomainAllowAction,
  deleteDomainBlockAction,
  importKnownDomainBlocklistAction
} from '@/app/(timeline)/admin/federation/actions'
import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import { Textarea } from '@/lib/components/ui/textarea'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { KNOWN_DOMAIN_BLOCKLIST_SOURCES } from '@/lib/services/federation/blocklistSources'
import { toPublicDomainBlock } from '@/lib/services/federation/domainRules'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<Record<string, string | undefined>>
}

const STATUS_MESSAGES: Record<string, string> = {
  'block-saved': 'Domain block saved',
  'block-deleted': 'Domain block deleted',
  'allow-saved': 'Domain allow saved',
  'allow-deleted': 'Domain allow deleted',
  'invalid-block-domain': 'Enter a valid domain to block',
  'invalid-allow-domain': 'Enter a valid domain to allow',
  'invalid-source': 'Choose a known blocklist source',
  'import-failed': 'Unable to import the blocklist'
}

const ADMIN_FEDERATION_PAGE_SIZE = 100

const getStatusMessage = (status?: string): string | null => {
  if (!status) return null
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status]

  const match = /^imported-(\d+)-(\d+)-(\d+)$/.exec(status)
  if (!match) return null

  return `Imported ${match[1]} new block${match[1] === '1' ? '' : 's'}, updated ${match[2]}, skipped ${match[3]}`
}

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const [{ status }, blocks, allows, stats] = await Promise.all([
    searchParams,
    database.getDomainBlocks({ limit: ADMIN_FEDERATION_PAGE_SIZE }),
    database.getDomainAllows({ limit: ADMIN_FEDERATION_PAGE_SIZE }),
    database.getDomainFederationRuleStats()
  ])
  const statusMessage = getStatusMessage(status)
  const sourceCounts = new Map(Object.entries(stats.sourceCounts))
  const config = getConfig()
  const federationMode = config.federationMode ?? 'open'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Federation</h1>
        <p className="text-sm text-muted-foreground">
          {federationMode === 'allowlist'
            ? 'Limited federation mode'
            : 'Open federation mode'}
        </p>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
          {statusMessage}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-background/80 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <ShieldBan className="h-5 w-5 text-destructive" />
            <div>
              <p className="text-sm text-muted-foreground">Blocked domains</p>
              <p className="text-2xl font-bold">{stats.blocks}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-background/80 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-sm text-muted-foreground">Allowed domains</p>
              <p className="text-2xl font-bold">{stats.allows}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-background/80 p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Shared-list entries</p>
          <p className="text-2xl font-bold">{stats.sourceBlocks}</p>
        </div>
      </div>

      <section className="rounded-xl border bg-background/80 p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Known Blocklist</h2>
            <p className="text-sm text-muted-foreground">
              Import a Mastodon-compatible CSV source.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          {KNOWN_DOMAIN_BLOCKLIST_SOURCES.map((source) => (
            <form
              key={source.id}
              action={importKnownDomainBlocklistAction}
              className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <input type="hidden" name="source" value={source.id} />
              <div>
                <p className="font-medium">{source.name}</p>
                <p className="text-sm text-muted-foreground">
                  {sourceCounts.get(source.id) ?? 0} imported entries
                </p>
              </div>
              <Button type="submit" className="sm:w-auto">
                <Download className="h-4 w-4" />
                Import
              </Button>
            </form>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-background/80 p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Add Domain Block</h2>
          <form action={createDomainBlockAction} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="block-domain">Domain</Label>
              <Input
                id="block-domain"
                required
                name="domain"
                placeholder="example.social"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="block-severity">Severity</Label>
              <Select
                id="block-severity"
                name="severity"
                defaultValue="suspend"
              >
                <option value="suspend">Suspend</option>
                <option value="silence">Silence</option>
                <option value="noop">Noop</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="block-public-comment">Public comment</Label>
              <Textarea
                id="block-public-comment"
                name="publicComment"
                rows={2}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Label>
                <Checkbox name="rejectMedia" />
                Reject media
              </Label>
              <Label>
                <Checkbox name="rejectReports" />
                Reject reports
              </Label>
              <Label>
                <Checkbox name="obfuscate" />
                Obfuscate
              </Label>
            </div>
            <Button type="submit">Save block</Button>
          </form>
        </div>

        <div className="rounded-xl border bg-background/80 p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Add Domain Allow</h2>
          <form action={createDomainAllowAction} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="allow-domain">Domain</Label>
              <Input
                id="allow-domain"
                required
                name="domain"
                placeholder="trusted.social"
              />
            </div>
            <Button type="submit">Save allow</Button>
          </form>
        </div>
      </section>

      <section className="rounded-xl border bg-background/80 p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Domain Blocks</h2>
        {stats.blocks > blocks.length && (
          <p className="mb-3 text-sm text-muted-foreground">
            Showing first {blocks.length} of {stats.blocks} blocked domains.
          </p>
        )}
        <div className="space-y-2">
          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No domains blocked</p>
          ) : (
            blocks.map((block) => {
              const publicBlock = toPublicDomainBlock(block)
              return (
                <div
                  key={block.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{block.domain}</p>
                    <p className="text-sm text-muted-foreground">
                      {block.severity}
                      {publicBlock.comment ? ` - ${publicBlock.comment}` : ''}
                    </p>
                  </div>
                  <form action={deleteDomainBlockAction}>
                    <input type="hidden" name="id" value={block.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete block for ${block.domain}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </form>
                </div>
              )
            })
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-background/80 p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Domain Allows</h2>
        {stats.allows > allows.length && (
          <p className="mb-3 text-sm text-muted-foreground">
            Showing first {allows.length} of {stats.allows} allowed domains.
          </p>
        )}
        <div className="space-y-2">
          {allows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No domains allowed</p>
          ) : (
            allows.map((allow) => (
              <div
                key={allow.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-4"
              >
                <p className="min-w-0 truncate font-medium">{allow.domain}</p>
                <form action={deleteDomainAllowAction}>
                  <input type="hidden" name="id" value={allow.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete allow for ${allow.domain}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

export default Page
