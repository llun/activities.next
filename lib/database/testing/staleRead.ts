// For tests of "read, then write" code that must survive another request
// writing in between. Neither backend makes that read-then-write atomic, and a
// test cannot time a second connection to land exactly in the gap, so the gap
// is staged instead: the first SELECT from `table` sees what `stale` returns
// rather than what is stored (the state before the other request wrote), and
// every later statement hits the real database.
import {
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type RootOperationNode,
  SelectQueryNode,
  TableNode,
  type UnknownRow
} from 'kysely'

import type { Db } from '@/lib/database/kysely'

const selectsFrom = (node: RootOperationNode, table: string) =>
  SelectQueryNode.is(node) &&
  (node.from?.froms ?? []).some(
    (from) => TableNode.is(from) && from.table.identifier.name === table
  )

export const withStaleFirstRead = (
  db: Db,
  table: string,
  stale: (rows: UnknownRow[]) => UnknownRow[]
): Db => {
  const staged = new Set<unknown>()
  let used = false
  const plugin: KyselyPlugin = {
    transformQuery: ({ node, queryId }: PluginTransformQueryArgs) => {
      if (!used && selectsFrom(node, table)) {
        used = true
        staged.add(queryId)
      }
      return node
    },
    transformResult: async ({ result, queryId }: PluginTransformResultArgs) =>
      staged.delete(queryId) ? { ...result, rows: stale(result.rows) } : result
  }
  return db.withPlugin(plugin)
}
