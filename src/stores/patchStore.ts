import type { AugmentedPatch, Patch } from '../types'
import { computed, effect, ref, shallowRef, unref } from '@vue/reactivity'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { useAliasStore, useEnvStore, useGitStore, useWebviewStore } from '.'
import { loadPatch, loadPatches } from '../helpers'
import { rerenderAllItemsInPatchesView, rerenderSomeItemsInPatchesView } from '../ux'

setActivePinia(createPinia())

export const usePatchStore = defineStore('patch', () => {
  const tsWhenLoadedAll = ref<number>()

  // Shallow on purpose: patches are a large tree (revisions, discussions, reviews, reactions)
  // read across sorting, tooltips and webview serialization; deep-proxying it all is pure
  // overhead. Updates already flow through wholesale reassignment (below) or explicit
  // rerenders.
  const patches = shallowRef<AugmentedPatch[]>()
  effect(() => {
    patches.value
      ? rerenderSomeItemsInPatchesView(patches.value)
      : rerenderAllItemsInPatchesView()
  })
  effect(() => {
    // Patches view items should be recalculated when any of those change
    // so we read them, even if unused, to bind them as dependencies to `effect`.
    // `aliasByNId` is included so patches re-map (picking up author aliases) once the address
    // book is read/refreshed.
    const { currentRepoId, currentRepoInfo, localIdentity } = useEnvStore()
    void currentRepoInfo?.delegates
    void localIdentity?.DID
    void useAliasStore().aliasByNId

    currentRepoId && resetAllPatches()
  })

  // TODO: maninak do similar and use latest commit to resolve the currently checked out
  // revision?
  const prevCheckedOutPatch = ref<AugmentedPatch>()
  const checkedOutPatch = computed<AugmentedPatch | undefined>((_prevCheckedOutPatch) => {
    prevCheckedOutPatch.value = _prevCheckedOutPatch

    const matchPatchIdFromUpstreamBranchRegex = /rad\/patches\/([0-9A-Fa-f]*)/
    const checkedOutPatchId = useGitStore().currentUpstreamBranch?.match(
      matchPatchIdFromUpstreamBranchRegex,
    )?.[1]

    const newCheckedOutPatch = checkedOutPatchId ? findPatchById(checkedOutPatchId) : undefined

    return newCheckedOutPatch
  })
  effect(() => {
    // `checkedOutPatch` must be read (and thus recomputed) *before* `prevCheckedOutPatch`:
    // its recompute is what refreshes `prevCheckedOutPatch`, and this effect cannot
    // retrigger itself off that write, so reading prev first would rerender a stale item
    rerenderSomeItemsInPatchesView(
      [checkedOutPatch.value, prevCheckedOutPatch.value].filter(Boolean),
    )
  })

  function findPatchById(partialOrWholeId: string) {
    const foundPatch = patches.value?.find((patch) => patch.id.includes(partialOrWholeId))

    return foundPatch
  }

  function findPatchByTitle(partialTitle: string) {
    const foundPatch = patches.value?.find((patch) => patch.title.includes(partialTitle))

    return foundPatch
  }

  function reloadPatch(patchId: Patch['id']) {
    const rid = useEnvStore().currentRepoId
    if (!rid) {
      return { error: new Error('Failed resolving RID') }
    }

    const nowTs = Date.now() / 1000 // we divide to align with the patch data timestamp format
    const { data: loadedPatch, error } = loadPatch(rid, patchId)
    if (error) {
      return { error }
    }

    const existingPatch = findPatchById(loadedPatch.id)
    const augmentedLoadedPatch = { ...loadedPatch, ...{ lastLoadedTs: nowTs } }
    if (existingPatch) {
      // we use `Object.assign()` to keep the same object ref
      Object.assign(existingPatch, augmentedLoadedPatch)
      // HACK: these below should be getting triggered reactively but they don't :/
      rerenderSomeItemsInPatchesView(existingPatch)
      useWebviewStore().find(`webview-patch-detail_${patchId}`)?.effectRunner()
    } else {
      // reassign (not push) so the shallowRef notifies its dependents
      patches.value = [...(patches.value ?? []), augmentedLoadedPatch]
    }

    return {}
  }

  function loadAllPatches() {
    const rid = useEnvStore().currentRepoId
    if (!rid) {
      return false
    }
    const nowTs = Date.now() / 1000 // we divide to align with the patch data timestamp format

    const { data: loadedPatches, error } = loadPatches(rid)
    if (error) {
      // leave `tsWhenLoadedAll` unset on failure, so `initStoreIfNeeded` retries on the next
      // tree refresh instead of treating this repo as permanently (if emptily) loaded
      return false
    }

    tsWhenLoadedAll.value = nowTs
    patches.value = loadedPatches.map((loadedPatch) => ({
      ...loadedPatch,
      ...{ lastLoadedTs: nowTs },
    }))

    return true
  }

  function initStoreIfNeeded() {
    return !tsWhenLoadedAll.value && loadAllPatches()
  }

  function resetAllPatches() {
    patches.value = undefined
    tsWhenLoadedAll.value = undefined
  }

  const lastLoadedTs = computed(() => {
    const ts = unref(
      patches.value?.length === 1 ? patches.value[0]?.lastLoadedTs : tsWhenLoadedAll,
    )

    return ts
  })

  return {
    patches,
    checkedOutPatch,
    lastLoadedTs,
    findPatchById,
    findPatchByTitle,
    resetAllPatches,
    reloadPatch,
    initStoreIfNeeded,
  }
})
