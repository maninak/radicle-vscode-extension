import { describe, expect, it } from 'vitest'
import {
  type PanelReuseCandidate,
  resolvePanelReuse,
} from '../../../src/helpers/webviewPanelReuse'

function candidate(
  panel: string,
  data: string,
  isPreview: boolean,
): PanelReuseCandidate<string> {
  return { panel, data, isPreview }
}

describe('resolvePanelReuse', () => {
  describe("with intent 'reusePreview' (a normal open)", () => {
    it('creates a new preview panel when no panels are live', () => {
      const decision = resolvePanelReuse({
        intent: 'reusePreview',
        data: 'patchA',
        candidates: [],
      })

      expect(decision).toEqual({ verb: 'create', asPreview: true })
    })

    it('creates a new preview panel when only standalone panels render other data', () => {
      const decision = resolvePanelReuse({
        intent: 'reusePreview',
        data: 'patchA',
        candidates: [candidate('standaloneB', 'patchB', false)],
      })

      expect(decision).toEqual({ verb: 'create', asPreview: true })
    })

    it('retargets the preview panel when it renders different data', () => {
      const decision = resolvePanelReuse({
        intent: 'reusePreview',
        data: 'patchA',
        candidates: [candidate('preview', 'patchB', true)],
      })

      expect(decision).toEqual({ verb: 'retarget', panel: 'preview' })
    })

    it('reveals the preview panel when it already renders the data', () => {
      const decision = resolvePanelReuse({
        intent: 'reusePreview',
        data: 'patchA',
        candidates: [candidate('preview', 'patchA', true)],
      })

      expect(decision).toEqual({ verb: 'reveal', panel: 'preview' })
    })

    it('reveals a standalone panel already rendering the data instead of retargeting', () => {
      const decision = resolvePanelReuse({
        intent: 'reusePreview',
        data: 'patchA',
        candidates: [
          candidate('preview', 'patchB', true),
          candidate('standaloneA', 'patchA', false),
        ],
      })

      expect(decision).toEqual({ verb: 'reveal', panel: 'standaloneA' })
    })

    it('prefers revealing a standalone panel over the preview panel rendering the same data', () => {
      const decision = resolvePanelReuse({
        intent: 'reusePreview',
        data: 'patchA',
        candidates: [
          candidate('preview', 'patchA', true),
          candidate('standaloneA', 'patchA', false),
        ],
      })

      expect(decision).toEqual({ verb: 'reveal', panel: 'standaloneA' })
    })
  })

  describe("with intent 'standalone' (an explicit open to the side)", () => {
    it('creates a new standalone panel when no panels are live', () => {
      const decision = resolvePanelReuse({
        intent: 'standalone',
        data: 'patchA',
        candidates: [],
      })

      expect(decision).toEqual({ verb: 'create', asPreview: false })
    })

    it('creates a new standalone panel even when the preview panel renders the data', () => {
      const decision = resolvePanelReuse({
        intent: 'standalone',
        data: 'patchA',
        candidates: [candidate('preview', 'patchA', true)],
      })

      expect(decision).toEqual({ verb: 'create', asPreview: false })
    })

    it('reveals a standalone panel already rendering the data instead of duplicating it', () => {
      const decision = resolvePanelReuse({
        intent: 'standalone',
        data: 'patchA',
        candidates: [
          candidate('preview', 'patchB', true),
          candidate('standaloneA', 'patchA', false),
        ],
      })

      expect(decision).toEqual({ verb: 'reveal', panel: 'standaloneA' })
    })

    it('never retargets the preview panel', () => {
      const decision = resolvePanelReuse({
        intent: 'standalone',
        data: 'patchA',
        candidates: [
          candidate('preview', 'patchB', true),
          candidate('standaloneC', 'patchC', false),
        ],
      })

      expect(decision).toEqual({ verb: 'create', asPreview: false })
    })
  })
})
