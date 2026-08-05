import type { Queryable } from '../db'
import { ApiError } from '../errors'
import { comparePositions, nextPosition } from '../positions'
import type { NodeInsert } from '../repos/nodes'
import { NodeRepo } from '../repos/nodes'
import { toPosition, fromPosition } from '../positions'

export const invalidImport = (message: string): ApiError => new ApiError(400, 'invalid_import', message)

export const normalizePosition = (key: string): string => toPosition(fromPosition(key))

const assertValidNode = (node: NodeInsert): void => {
  if (node.type === 'bookmark' && !node.url) throw invalidImport(`bookmark ${node.id} requires a url`)
  if (node.type === 'folder' && node.url) throw invalidImport(`folder ${node.id} must not have a url`)
  if (node.type === 'folder' && !node.title) throw invalidImport(`folder ${node.id} requires a title`)
  if (!node.title) throw invalidImport(`node ${node.id} requires a title`)
}

const detectCycle = (nodes: NodeInsert[]): void => {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw invalidImport(`directory cycle detected at ${id}`)
    visiting.add(id)
    const node = byId.get(id)
    if (node) visit(node.parentId)
    visiting.delete(id)
    visited.add(id)
  }
  for (const node of nodes) visit(node.id)
}

/**
 * Validates a batch of nodes: no duplicate IDs, safe types, parents exist
 * either in the batch or as active nodes in the namespace, and no cycles.
 */
export const validateBatch = async (
  client: Queryable,
  namespaceId: string,
  nodes: NodeInsert[],
): Promise<void> => {
  const ids = new Set<string>()
  for (const node of nodes) {
    if (ids.has(node.id)) throw invalidImport(`duplicate node id ${node.id}`)
    ids.add(node.id)
    assertValidNode(node)
  }
  detectCycle(nodes)
  const repo = new NodeRepo(client)
  const batchIds = new Set(nodes.map((node) => node.id))
  for (const node of nodes) {
    if (node.parentId === '') continue
    if (batchIds.has(node.parentId)) continue
    const parent = await repo.getActive(namespaceId, node.parentId)
    if (!parent || parent.type !== 'folder') throw invalidImport(`missing parent ${node.parentId} for ${node.id}`)
  }
}

const childOrder = (nodes: NodeInsert[]): Map<string, NodeInsert[]> => {
  const order = new Map<string, NodeInsert[]>()
  for (const node of nodes) {
    const list = order.get(node.parentId) ?? []
    list.push(node)
    order.set(node.parentId, list)
  }
  return order
}

/**
 * Assigns deterministic positions. Nodes under an existing cloud parent are
 * appended after current active children; nodes inside the batch keep their
 * relative order. Roots with a client position key keep it when free.
 */
export const assignPositions = async (
  client: Queryable,
  namespaceId: string,
  nodes: NodeInsert[],
): Promise<NodeInsert[]> => {
  const repo = new NodeRepo(client)
  const byParent = childOrder(nodes)
  const done = new Map<string, NodeInsert>()
  const batchIds = new Set(nodes.map((node) => node.id))

  const positionFor = async (node: NodeInsert): Promise<string> => {
    const siblings = await repo.getChildren(namespaceId, node.parentId)
    const batchSiblings = byParent.get(node.parentId) ?? []
    const positioned = batchSiblings.filter((candidate) => done.has(candidate.id)).map((candidate) => done.get(candidate.id)!)
    const existingKeys = siblings.map((sibling) => sibling.positionKey)
    const requested = node.positionKey ? normalizePosition(node.positionKey) : null
    if (requested && !existingKeys.includes(requested)) return requested
    const used = new Set([...existingKeys, ...positioned.map((candidate) => candidate.positionKey)])
    const max = used.size ? [...used].reduce((a, b) => (comparePositions(a, b) >= 0 ? a : b)) : null
    return max ? nextPosition([max]) : nextPosition([])
  }

  // process roots first, then descend so child ordering under batch parents is stable
  const ordered: NodeInsert[] = []
  const queue = nodes.filter((node) => node.parentId === '')
  const seen = new Set<string>()
  while (queue.length > 0) {
    const node = queue.shift()!
    if (seen.has(node.id)) continue
    seen.add(node.id)
    ordered.push(node)
    const children = byParent.get(node.id) ?? []
    queue.push(...children)
  }
  for (const node of nodes) if (!seen.has(node.id)) ordered.push(node)

  const result: NodeInsert[] = []
  for (const node of ordered) {
    const positioned = { ...node, positionKey: await positionFor(node) }
    result.push(positioned)
    done.set(positioned.id, positioned)
  }
  return result
}
