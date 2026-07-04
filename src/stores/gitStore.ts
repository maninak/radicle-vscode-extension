import { computed, ref } from '@vue/reactivity'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { getCurrentGitBranchAndUpstream } from '../utils'

setActivePinia(createPinia())

/*
 * Sources the workspace repo's current branch and upstream by shelling out to git directly,
 * with our file watchers as the invalidation trigger (see `fileWatcher.ts`). VS Code's built-in
 * Git extension API was evaluated and rejected for this: its `repository.state` is a debounced
 * cache that refreshes only while the window is focused, so it goes stale exactly when `rad`
 * mutates git state out of band (e.g. `rad patch checkout` in a terminal). GitLens reads git
 * the same way we do, for the same reason. See issue #185 for the full investigation.
 */
export const useGitStore = defineStore('gitStore', () => {
  const currentBranchRecomputeSignal = ref(0)

  const currentBranchAndUpstream = computed(() => {
    void currentBranchRecomputeSignal.value

    return getCurrentGitBranchAndUpstream()
  })
  const currentBranch = computed(() => currentBranchAndUpstream.value?.branch)
  const currentUpstreamBranch = computed(() => currentBranchAndUpstream.value?.upstream)

  function refreshCurentBranch() {
    currentBranchRecomputeSignal.value++
  }

  return {
    currentBranch,
    currentUpstreamBranch,
    refreshCurentBranch,
  }
})
