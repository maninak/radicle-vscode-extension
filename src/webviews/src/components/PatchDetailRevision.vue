<script setup lang="ts">
import type { Revision } from '../../../types'
import {
  provideVSCodeDesignSystem,
  vsCodeButton,
  vsCodeDropdown,
  vsCodeOption,
} from '@vscode/webview-ui-toolkit'
import { storeToRefs } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import { getIdentityAliasOrId, shortenHash } from 'extensionUtils/string'
import {
  getDateInIsoWithZeroedTimezone,
  getFormattedDate,
  getTimeAgo,
} from 'extensionUtils/time'
import { notifyExtension } from 'extensionUtils/webview-messaging'
import Markdown from '@/components/Markdown.vue'
import Metadatum from '@/components/Metadatum.vue'
import { usePatchDetailStore } from '@/stores/patchDetailStore'
import Reactions from './Reactions.vue'

defineProps<{ showHeading: boolean }>()
defineEmits<{ showCreateCommentForm: [targetRevision: Revision] }>()

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDropdown(), vsCodeOption())

const { patch, authors, firstRevision, latestRevision, mergedRevision, timeLocale } =
  storeToRefs(usePatchDetailStore())

const revisionOptionsMap = computed(
  () =>
    new Map(
      [...patch.value.revisions]
        .reverse()
        .map((revision) => [assembleRevisionOptionLabel(revision), revision]),
    ),
)
const selectedRevisionOption = ref(
  assembleRevisionOptionLabel(mergedRevision.value ?? latestRevision.value),
)
const selectedRevision = computed(() => {
  const selRev = revisionOptionsMap.value.get(selectedRevisionOption.value)
  if (selRev) {
    return selRev
  }

  // Options got updated and our selected option doesn't match any more. Reset.
  const fallbackSelRev = mergedRevision.value ?? latestRevision.value
  // eslint-disable-next-line vue/no-side-effects-in-computed-properties
  selectedRevisionOption.value = assembleRevisionOptionLabel(fallbackSelRev)

  return fallbackSelRev
})

function selectRevision(revision: Revision) {
  selectedRevisionOption.value = assembleRevisionOptionLabel(revision)
}

function assembleRevisionOptionLabel(revision: Revision): string {
  const id = shortenHash(revision.id)
  const timeAgo = getTimeAgo(revision.timestamp, 'mini')
  const state = [
    patch.value.merges.map((merge) => merge.revision).includes(revision.id) &&
      `merged${patch.value.merges.length >= 2 ? `/${patch.value.merges.length}` : ''}`, // TODO: maninak should be `merges-count/required-delegate-count` instead
    revision.reviews.find((review) => review.verdict === 'accept') && 'accepted',
    revision.reviews.find((review) => review.verdict === 'reject') && 'rejected',
    patch.value.revisions.length >= 2 && revision.id === firstRevision.value.id && 'first',
    patch.value.revisions.length >= 2 && revision.id === latestRevision.value.id && 'latest',
    patch.value.revisions.length === 1 && 'sole',
  ].filter(Boolean)
  const parsedState = state.length ? ` [${state.join(', ')}]` : ''
  const author = authors.value.length >= 2 ? ` ${getIdentityAliasOrId(revision.author)}` : ''
  const label = `${id}${parsedState} ${timeAgo}${author}`

  return label
}

const shouldHideRevisionDescription = computed(
  () =>
    selectedRevision.value.description && selectedRevision.value.id === firstRevision.value.id,
)
const selectedRevisionAcceptedReviews = computed(() =>
  selectedRevision.value.reviews.filter((review) => review.verdict === 'accept'),
)
const selectedRevisionRejectedReviews = computed(() =>
  selectedRevision.value.reviews.filter((review) => review.verdict === 'reject'),
)

function browseRevisionDiff() {
  notifyExtension({
    command: 'openRevisionDiff',
    payload: { patch: toRaw(patch.value), revisionId: selectedRevision.value.id },
  })
}

defineExpose({ selectedRevision, selectRevision })
</script>

<template>
  <section>
    <h2 v-if="showHeading" class="mb-3 mt-0 text-lg font-normal">Revision</h2>
    <div class="mb-3 flex flex-wrap gap-2">
      <vscode-dropdown
        :value="selectedRevisionOption"
        title="Select a Patch Revision to See More Info About It"
        class="max-w-full rounded-none font-mono"
        @change="(ev: CustomEvent) => (selectedRevisionOption = ev.detail._value)"
      >
        <vscode-option
          v-for="revisionOption in revisionOptionsMap.keys()"
          :key="revisionOption"
          class="font-mono"
        >
          {{ revisionOption }}
        </vscode-option>
      </vscode-dropdown>
      <div class="flex gap-x-1">
        <vscode-button
          appearance="secondary"
          title="Begin Authoring a Comment on the Selected Revision"
          @click="$emit('showCreateCommentForm', selectedRevision)"
        >
          Comment
        </vscode-button>
        <vscode-button
          appearance="secondary"
          title="Browse All of the Selected Revision's Changed Files in a Multi-File Diff"
          @click="browseRevisionDiff"
        >
          Browse Diff
        </vscode-button>
      </div>
    </div>
    <Metadatum label="Id">
      <pre :title="selectedRevision.id">{{ shortenHash(selectedRevision.id) }}</pre>
      <template #aside>
        <vscode-button
          appearance="icon"
          title="Copy Revision Identifier to Clipboard"
          @click="
            notifyExtension({
              command: 'copyToClipboardAndNotify',
              payload: { textToCopy: selectedRevision.id },
            })
          "
        >
          <span class="codicon codicon-copy"></span>
        </vscode-button>
      </template>
    </Metadatum>
    <Metadatum label="Author">
      <pre :title="selectedRevision.author.id">{{
        getIdentityAliasOrId(selectedRevision.author)
      }}</pre>
    </Metadatum>
    <Metadatum
      v-if="selectedRevisionAcceptedReviews.length || selectedRevisionRejectedReviews.length"
      label="Reviews"
    >
      <span class="flex items-center gap-[1em]">
        <span
          v-if="selectedRevisionAcceptedReviews.length"
          class="flex items-start gap-x-[0.5em]"
        >
          <span class="codicon codicon-thumbsup" title="Accepted Revision"></span>
          <span v-for="review in selectedRevisionAcceptedReviews" :key="review.timestamp">
            <pre :title="review.author.id">{{ getIdentityAliasOrId(review.author) }}</pre>
          </span>
        </span>
        <span
          v-if="selectedRevisionRejectedReviews.length"
          class="flex items-start gap-x-[0.5em]"
        >
          <span class="codicon codicon-thumbsdown" title="Rejected Revision"></span>
          <span v-for="review in selectedRevisionRejectedReviews" :key="review.timestamp">
            <pre :title="selectedRevision.author.id">{{
              getIdentityAliasOrId(selectedRevision.author)
            }}</pre>
          </span>
        </span>
      </span>
    </Metadatum>
    <Metadatum label="Date">
      <span
        :title="getDateInIsoWithZeroedTimezone(selectedRevision.timestamp)"
        class="font-mono"
      >
        {{ getFormattedDate(selectedRevision.timestamp, timeLocale) }}
      </span>
    </Metadatum>
    <Metadatum label="Latest commit">
      <pre :title="selectedRevision.oid">{{ shortenHash(selectedRevision.oid) }}</pre>
      <template #aside>
        <vscode-button
          appearance="icon"
          title="Copy Commit Identifier to Clipboard"
          @click="
            notifyExtension({
              command: 'copyToClipboardAndNotify',
              payload: { textToCopy: selectedRevision.oid },
            })
          "
        >
          <span class="codicon codicon-copy"></span>
        </vscode-button>
      </template>
    </Metadatum>
    <Metadatum label="Based on commit">
      <pre :title="selectedRevision.base">{{ shortenHash(selectedRevision.base) }}</pre>
      <template #aside>
        <vscode-button
          appearance="icon"
          title="Copy Commit Identifier to Clipboard"
          @click="
            notifyExtension({
              command: 'copyToClipboardAndNotify',
              payload: { textToCopy: selectedRevision.base },
            })
          "
        >
          <span class="codicon codicon-copy"></span>
        </vscode-button>
      </template>
    </Metadatum>
    <Metadatum v-if="selectedRevision.reactions.length" label="Reactions">
      <Reactions :reactions="selectedRevision.reactions" />
    </Metadatum>
    <!-- TODO: show names of all unique committers and their email on hover -->
    <div v-if="selectedRevision.description" class="mt-4">
      <details v-if="shouldHideRevisionDescription">
        <summary title="Click to Expand/Collapse">Description</summary>
        <Markdown :source="selectedRevision.description" class="mt-[0.25em] text-sm" />
      </details>
      <Markdown v-else :source="selectedRevision.description" class="text-sm" />
    </div>
  </section>
</template>
