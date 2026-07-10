import { describe, expect, it } from 'vitest'
import { getStateMergedWithUpdate } from '../patchDetail'

function makeCurrentState() {
  return {
    kind: 'webview-patch-detail',
    panelKind: 'preview',
    state: { patch: { id: 'patchA', title: 'Patch A' }, defaultBranch: 'main' },
    injectedStateIds: [111],
    patchEditForm: { title: 'edited title', descr: 'edited descr', status: 'editing' },
    patchCommentForm: { rev1: { comment: 'draft comment', status: 'editing' } },
  }
}

function makePristineExtraState() {
  return {
    injectedStateIds: [] as number[],
    patchEditForm: { title: '', descr: '', status: 'off' },
    patchCommentForm: {},
  }
}

describe('getStateMergedWithUpdate', () => {
  it('applies the update and keeps form drafts when it concerns the same patch', () => {
    const update = {
      id: 222,
      state: { patch: { id: 'patchA', title: 'Patch A renamed' }, defaultBranch: 'main' },
    }

    const merged = getStateMergedWithUpdate(
      makeCurrentState(),
      makePristineExtraState(),
      update,
    )

    expect(merged.state.patch).toEqual({ id: 'patchA', title: 'Patch A renamed' })
    expect(merged.patchEditForm).toEqual({
      title: 'edited title',
      descr: 'edited descr',
      status: 'editing',
    })

    expect(merged.patchCommentForm).toEqual({
      rev1: { comment: 'draft comment', status: 'editing' },
    })

    expect(merged.injectedStateIds).toEqual([111])
  })

  it('resets form drafts when the panel got retargeted to a different patch', () => {
    const update = {
      id: 222,
      state: { patch: { id: 'patchB', title: 'Patch B' }, defaultBranch: 'main' },
    }

    const merged = getStateMergedWithUpdate(
      makeCurrentState(),
      makePristineExtraState(),
      update,
    )

    expect(merged.state.patch).toEqual({ id: 'patchB', title: 'Patch B' })
    expect(merged.patchEditForm).toEqual({ title: '', descr: '', status: 'off' })
    expect(merged.patchCommentForm).toEqual({})
  })

  it('keeps the consumed injected-state ids and panel kind across a patch retarget', () => {
    const update = {
      id: 222,
      state: { patch: { id: 'patchB', title: 'Patch B' }, defaultBranch: 'main' },
    }

    const merged = getStateMergedWithUpdate(
      makeCurrentState(),
      makePristineExtraState(),
      update,
    )

    expect(merged.injectedStateIds).toEqual([111])
    expect(merged.panelKind).toBe('preview')
  })
})
