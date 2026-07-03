// NOTE: all types must be _manually_ kept in sync with the shape emitted by `rad cob show`

import type { Comment, Embed, NId, Patch, RadicleIdentity } from './httpd'

export interface CobEdit {
  author: NId
  timestamp: number
  body: string
  embeds: Embed[]
}

export interface CobReaction {
  emoji: string
  authors: NId[]
  location?: Comment['location'] | null
}

/**
 * A comment's reactions are serialized differently from a revision's: instead of `CobReaction`
 * objects, each is a `[authorNId, emoji]` tuple, one per author-emoji pair.
 */
export type CobCommentReaction = [author: NId, emoji: string]

export interface CobComment {
  author: NId
  reactions: CobCommentReaction[]
  resolved: boolean
  body: string
  edits: CobEdit[]
  replyTo?: string
  location?: Comment['location']
}

export interface CobReview {
  id: string
  author: RadicleIdentity
  verdict?: 'accept' | 'reject' | null
  summary: CobEdit[]
  comments: { comments: Record<string, CobComment>; timeline: string[] }
  timestamp: number
}

export interface CobRevision {
  id: string
  author: RadicleIdentity
  description: CobEdit[]
  base: string
  oid: string
  discussion: { comments: Record<string, CobComment>; timeline: string[] }
  reviews: Record<NId, CobReview | null>
  timestamp: number
  reactions: CobReaction[]
}

export interface CobPatch {
  title: string
  author: RadicleIdentity
  state: Patch['state']
  target: string
  labels: string[]
  merges: Record<NId, { revision: string; commit: string; timestamp: number }>
  revisions: Record<string, CobRevision | null>
  assignees: string[]
}
