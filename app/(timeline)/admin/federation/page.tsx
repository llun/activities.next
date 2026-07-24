import {
  ChevronLeft,
  ChevronRight,
  Download,
  ShieldBan,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import {
  createDomainAllowAction,
  createDomainBlockAction,
  deleteDomainAllowAction,
  deleteDomainBlockAction,
  importKnownDomainBlocklistAction
} from '@/app/(timeline)/admin/federation/actions'
import { FederationPolicyForm } from '@/lib/components/admin/settings/FederationPolicyForm'
import { PageHeader } from '@/lib/components/page-header'
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
import { getServerSettingsView } from '@/lib/services/serverSettings'
import { cn } from '@/lib/utils'
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

const ERROR_STATUSES = new Set([
  'invalid-block-domain',
  'invalid-allow-domain',
  'invalid-source',
  'import-failed'
])

const ADMIN_FEDERATION_PAGE_SIZE = 100

const getStatusMessage = (status?: string): string | null => {
  if (!status) return null
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status]

  const match = /^imported-(\d+)-(\d+)-(\d+)$/.exec(status)
  if (!match) return null

  return `Imported ${match[1]} new block${match[1] === '1' ? '' : 's'}, updated ${match[2]}, skipped ${match[3]}`
}

const getOffset = (value?: string): number => {
  const offset = Number(value ?? 0)
  return Number.isInteger(offset) && offset > 0 ? offset : 0
}

const getPaginationHref = ({
  blockOffset,
  allowOffset
}: {
  blockOffset: number
  allowOffset: number
}): string => {
  const params = new URLSearchParams()
  if (blockOffset > 0) params.set('blockOffset', String(blockOffset))
  if (allowOffset > 0) params.set('allowOffset', String(allowOffset))

  const query = params.toString()
  return query ? `/admin/federation?${query}` : '/admin/federation'
}

const getNextOffset = (offset: number, count: number): number => offset + count

const getPreviousOffset = (offset: number): number =>
  Math.max(0, offset - ADMIN_FEDERATION_PAGE_SIZE)

const getPaginationLabel = (
  noun: string,
  offset: number,
  count: number,
  total: number
): string => {
  if (count === 0) return `Showing 0 of ${total} ${noun}`
  return `Showing ${offset + 1}-${offset + count} of ${total} ${noun}`
}

const PaginationControls = ({
  label,
  previousHref,
  nextHref,
  hasPrevious,
  hasNext
}: {
  label: string
  previousHref: string
  nextHref: string
  hasPrevious: boolean
  hasNext: boolean
}) => (
  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <p className="text-sm text-muted-foreground">{label}</p>
    <div className="flex gap-2">
      {hasPrevious ? (
        <Button asChild variant="outline" size="sm">
          <Link href={previousHref}>
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Link>
        </Button>
      ) : (
        <Button disabled variant="outline" size="sm">
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
      )}
      {hasNext ? (
        <Button asChild variant="outline" size="sm">
          <Link href={nextHref}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      ) : (
        <Button disabled variant="outline" size="sm">
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  </div>
)

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const params = await searchParams
  const { status } = params
  const blockOffset = getOffset(params.blockOffset)
  const allowOffset = getOffset(params.allowOffset)

  const [blocks, allows, stats] = await Promise.all([
    database.getDomainBlocks({
      limit: ADMIN_FEDERATION_PAGE_SIZE,
      offset: blockOffset
    }),
    database.getDomainAllows({
      limit: ADMIN_FEDERATION_PAGE_SIZE,
      offset: allowOffset
    }),
    database.getDomainFederationRuleStats()
  ])
  const statusMessage = getStatusMessage(status)
  const isErrorStatus = status ? ERROR_STATUSES.has(status) : false
  const sourceCounts = new Map(Object.entries(stats.sourceCounts))
  const config = getConfig()
  const { settings, locks } = await getServerSettingsView(database)
  const federationMode = settings.federation.mode
  // Trusted media domains stay env-configured (they feed the Edge-runtime CSP),
  // so they are shown read-only in the policy form.
  const mediaDomains = config.allowMediaDomains ?? []
  const hasPreviousBlocks = blockOffset > 0
  const hasNextBlocks =
    blocks.length > 0 &&
    getNextOffset(blockOffset, blocks.length) < stats.blocks
  const hasPreviousAllows = allowOffset > 0
  const hasNextAllows =
    allows.length > 0 &&
    getNextOffset(allowOffset, allows.length) < stats.allows

  return (
    <div className="space-y-6">
      <PageHeader
        title="Federation"
        description={
          federationMode === 'allowlist'
            ? 'Limited federation mode.'
            : 'Open federation mode.'
        }
      />

      {statusMessage && (
        <div
          className={cn(
            'rounded-lg border px-4 py-3 text-sm',
            isErrorStatus
              ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100'
              : 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100'
          )}
        >
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

      <FederationPolicyForm
        settings={settings}
        locks={locks}
        mediaDomains={mediaDomains}
      />

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
              <p className="text-xs text-muted-foreground">
                Only Suspend rejects federation. Silence and Noop are stored for
                Mastodon-compatible metadata.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="block-public-comment">Public comment</Label>
              <Textarea
                id="block-public-comment"
                name="publicComment"
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="block-private-comment">Private comment</Label>
              <Textarea
                id="block-private-comment"
                name="privateComment"
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
        <div className="space-y-2">
          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No domains blocked</p>
          ) : (
            blocks.map((block) => (
              <div
                key={block.id}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{block.domain}</p>
                  <p className="text-sm text-muted-foreground">
                    {block.severity}
                    {block.publicComment ? ` - ${block.publicComment}` : ''}
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
            ))
          )}
        </div>
        <PaginationControls
          label={getPaginationLabel(
            'blocked domains',
            blockOffset,
            blocks.length,
            stats.blocks
          )}
          previousHref={getPaginationHref({
            blockOffset: getPreviousOffset(blockOffset),
            allowOffset
          })}
          nextHref={getPaginationHref({
            blockOffset: getNextOffset(blockOffset, blocks.length),
            allowOffset
          })}
          hasPrevious={hasPreviousBlocks}
          hasNext={hasNextBlocks}
        />
      </section>

      <section className="rounded-xl border bg-background/80 p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Domain Allows</h2>
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
        <PaginationControls
          label={getPaginationLabel(
            'allowed domains',
            allowOffset,
            allows.length,
            stats.allows
          )}
          previousHref={getPaginationHref({
            blockOffset,
            allowOffset: getPreviousOffset(allowOffset)
          })}
          nextHref={getPaginationHref({
            blockOffset,
            allowOffset: getNextOffset(allowOffset, allows.length)
          })}
          hasPrevious={hasPreviousAllows}
          hasNext={hasNextAllows}
        />
      </section>
    </div>
  )
}

export default Page
