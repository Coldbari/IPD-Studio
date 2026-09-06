import type { LineClass, NodeKind, Tag } from '../model/types'

export type AiOperation =
  | { type: 'setNodeTag'; nodeId: string; tag: Tag | null }
  | { type: 'setNodeLabel'; nodeId: string; label: string }
  | { type: 'setNodePosition'; nodeId: string; x: number; y: number }
  | { type: 'setNodeRotation'; nodeId: string; rotation: 0 | 90 | 180 | 270 }
  | { type: 'setNodeConfig'; nodeId: string; config: Record<string, string> }
  | { type: 'setEdgeArrow'; edgeId: string; arrow: 'none' | 'flow' }
  | { type: 'setEdgeClass'; edgeId: string; lineClass: LineClass }
  | { type: 'setPendingEndpointTag'; edgeId: string; end: 'source' | 'target'; tag: string | null }
  | { type: 'addNode'; clientId?: string; symbolId: string; kind: NodeKind; x: number; y: number; rotation?: 0 | 90 | 180 | 270; tag?: Tag; label?: string }
  | { type: 'addEdge'; lineClass: LineClass; source: { nodeId: string; portId: string } | { x: number; y: number; pendingTag?: string }; target: { nodeId: string; portId: string } | { x: number; y: number; pendingTag?: string }; arrow?: 'none' | 'flow' }

export interface AiReply {
  answer: string
  operations?: AiOperation[]
}
