<script setup lang="ts">
import type { Comment, Revision } from '../../../types'
import {
  provideVSCodeDesignSystem,
  vsCodeButton,
  vsCodeTextArea,
} from '@vscode/webview-ui-toolkit'
import { useEventListener } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, toRaw, useTemplateRef, watchEffect } from 'vue'
import {
  getIdentityAliasOrId,
  maxCharsForUntruncatedMdText,
  shortenHash,
  truncateMarkdown,
} from 'extensionUtils/string'
import { notifyExtension } from 'extensionUtils/webview-messaging'
import EventItem from '@/components/EventItem.vue'
import EventList from '@/components/EventList.vue'
import Markdown from '@/components/Markdown.vue'
import Reactions from '@/components/Reactions.vue'
import { getRevisionHoverTitle } from '@/helpers/patchDetail'
import { usePatchDetailStore } from '@/stores/patchDetailStore'
import { scrollToTemplateRef } from '@/utils/scrollToTemplateRef'

const { selectedRevision } = defineProps<{
  showHeading: boolean
  selectedRevision: Revision
}>()

defineEmits<{ showRevision: [revision: Revision] }>()

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeTextArea())

const { patch, firstRevision, patchCommentForm } = storeToRefs(usePatchDetailStore())

const commentRefs = useTemplateRef<InstanceType<typeof EventItem>[]>('commentRefs')
function scrollToComment(commentId: Comment['id']) {
  const foundCommentRef = commentRefs.value?.find(
    (commentEl) => commentEl.$attrs.id === commentId,
  )

  scrollToTemplateRef(foundCommentRef, {
    addClass: { class: 'pulse-outline', removeAfterMs: 2000 },
  })
}

const patchEvents = computed(() =>
  [
    patch.value.revisions.map(
      (revision) => ({ kind: 'revision', ts: revision.timestamp, revision }) as const,
    ),
    patch.value.revisions.flatMap((revision) =>
      revision.reviews.map(
        (review) => ({ kind: 'review', ts: review.timestamp, review, revision }) as const,
      ),
    ),
    patch.value.revisions.flatMap((revision) =>
      revision.discussions.map(
        (discussion) =>
          ({ kind: 'discussion', ts: discussion.timestamp, discussion, revision }) as const,
      ),
    ),
    patch.value.merges.map(
      (merge) =>
        ({
          kind: 'merge',
          ts: merge.timestamp,
          merge,
          revision: patch.value.revisions.find((revision) => revision.id === merge.revision),
        }) as const,
    ),
  ]
    .flat()
    .sort((ev1, ev2) => ev2.ts - ev1.ts),
)

// TODO: maninak extract to usePatchCommentForm? composable

const formRef = useTemplateRef<HTMLElement>('formRef')
const commentTextAreaRef = useTemplateRef<HTMLElement>('commentTextAreaRef')

// Those `watchEffect()`s should run once each time the respective elements get created
watchEffect(() => {
  formRef.value &&
    useEventListener(
      formRef.value,
      'keydown',
      (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
          submitPatchCommentForm()
        } else if (ev.key === 'Escape') {
          pausePatchCommenting()
        } else if (ev.key === 'p' && ev.altKey) {
          togglePreviewMarkdown()
        }
      },
      { passive: true },
    )
})
watchEffect(() => {
  if (patchCommentForm.value[selectedRevision.id]?.status === 'editing') {
    const el = commentTextAreaRef.value
    setTimeout(() => el?.focus(), 0) // Vue.nextTick isn't cutting it
    useEventListener(el, 'focus', alignViewportWithForm, { passive: true })
    useEventListener(el, 'input', alignViewportWithForm, { passive: true })
  }
})

function alignViewportWithForm() {
  formRef.value?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

interface VscodeTextAreaEvent {
  target: { _value: string }
}
function updatePatchCommentFormComment(ev: VscodeTextAreaEvent) {
  patchCommentForm.value[selectedRevision.id] = {
    comment: ev.target._value,
    status: 'editing',
  }
}

function pausePatchCommenting() {
  patchCommentForm.value[selectedRevision.id] = {
    comment: patchCommentForm.value[selectedRevision.id]?.comment || '',
    status: 'off',
  }
}

function submitPatchCommentForm() {
  const commentIdsBefore = commentRefs.value?.map((commentRef) => commentRef.$attrs.id)

  notifyExtension({
    command: 'createPatchComment',
    payload: {
      patch: toRaw(patch.value),
      revisionId: selectedRevision.id,
      comment: patchCommentForm.value[selectedRevision.id]?.comment?.trim() || '',
    },
  })

  // HACK: would be better to discard form IFF submition suceeded, but current webview-extension comm channel doesn't support notification replies
  discardPatchCommentForm()
  // HACK: we just wait :waves-hand: 3s for comment to be created, because currently we don't have a way to get notified when our previous `'createPatchComment'` notification to the extension succeeded
  setTimeout(() => {
    const createdCommentRef = commentRefs.value?.filter(
      (comment) => !commentIdsBefore?.includes(comment.$attrs.id),
    )[0]
    createdCommentRef?.$el.classList.add('pulse-outline')
    setTimeout(() => createdCommentRef?.$el.classList.remove('pulse-outline'), 2000)
  }, 2500)
}

function discardPatchCommentForm() {
  delete patchCommentForm.value[selectedRevision.id]
}

function togglePreviewMarkdown() {
  const selectedRevForm = patchCommentForm.value[selectedRevision.id]
  if (selectedRevForm?.status === 'editing') {
    selectedRevForm.status = 'previewing'

    if (formRef.value) {
      formRef.value.tabIndex = 0 // allows <form>, otherwise  non-tabbable, to be `focus()`ed
      formRef.value.focus() // make form keyboard shortcuts still work after toggling MD preview
      formRef.value.tabIndex = -1 // clean-up
    }
  } else if (selectedRevForm?.status === 'previewing') {
    selectedRevForm.status = 'editing'
    setTimeout(() => commentTextAreaRef.value?.focus(), 0)
  }
}

// TODO: show "edited" indicators + timestamp (on hover) or full-blown list of edits, for each revision, comment, etc anything that has edits
</script>

<template>
  <section>
    <!-- TODO: add button to expand/collapse all -->
    <h2 v-if="showHeading" class="mb-4 mt-0 text-lg font-normal">Activity</h2>
    <EventList>
      <EventItem
        v-if="
          patchCommentForm[selectedRevision.id]?.status === 'editing' ||
          patchCommentForm[selectedRevision.id]?.status === 'previewing'
        "
        :when="NaN"
        codicon="codicon-comment"
      >
        <form
          ref="formRef"
          name="Edit patch title and description"
          class="flex flex-col gap-y-3 pb-2 font-mono text-sm leading-[unset] outline-none"
          :class="{ 'w-fit': patchCommentForm[selectedRevision.id]?.status !== 'previewing' }"
          style="
            min-width: min(
              100%,
              68ch
            ); /* results in allowing 65 chars before resizing to be wider */
          "
          @submit.prevent
        >
          <vscode-text-area
            v-if="patchCommentForm[selectedRevision.id]?.status === 'editing'"
            ref="commentTextAreaRef"
            :value="patchCommentForm[selectedRevision.id]?.comment"
            placeholder="Share your kind thoughts…"
            name="patch comment"
            resize="vertical"
            maxlength="50000"
            @input="updatePatchCommentFormComment"
          >
            New Patch Comment:
          </vscode-text-area>

          <div
            v-if="patchCommentForm[selectedRevision.id]?.status === 'previewing'"
            class="group flex max-w-fit flex-col gap-y-4 border border-dashed border-[var(--vscode-focusBorder,var(--vscode-commandCenter-debuggingBackground))] p-1"
          >
            <Markdown
              :source="patchCommentForm[selectedRevision.id]?.comment || ''"
              class="text-sm"
            />
          </div>

          <div class="reset-font opacity-65">
            Target Revision:
            <pre class="ml-1">{{ shortenHash(selectedRevision.id) }}</pre>
          </div>

          <div class="flex w-full flex-row-reverse justify-between">
            <div class="flex flex-row-reverse justify-start gap-x-2">
              <vscode-button
                appearance="primary"
                title="Save New Comment to Radicle"
                @click="submitPatchCommentForm"
              >
                <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -->
                <span slot="start" class="codicon codicon-save"></span>
                Comment
              </vscode-button>
              <vscode-button
                appearance="secondary"
                title="Pause Editing, Preserving Current Changes for Later (Escape)"
                @click="pausePatchCommenting"
              >
                <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -->
                <span class="codicon codicon-coffee"></span>
              </vscode-button>
              <vscode-button
                appearance="secondary"
                title="Stop Editing and Discard Current Changes"
                @click="discardPatchCommentForm"
              >
                <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -->
                <span slot="start" class="codicon codicon-discard"></span>
                Discard
              </vscode-button>
            </div>
            <div class="flex flex-row-reverse justify-start gap-x-2">
              <vscode-button
                :appearance="
                  patchCommentForm[selectedRevision.id]?.status === 'previewing'
                    ? 'primary'
                    : 'secondary'
                "
                :title="
                  patchCommentForm[selectedRevision.id]?.status === 'previewing'
                    ? 'Stop Previewing as Rendered Markdown and Return to Editing (Alt + P)'
                    : 'Preview Changes as Rendered Markdown (Alt + P)'
                "
                class="self-center"
                @click="togglePreviewMarkdown"
              >
                <span
                  class="codicon"
                  :class="[
                    patchCommentForm[selectedRevision.id]?.status === 'previewing'
                      ? 'codicon-edit'
                      : 'codicon-markdown',
                  ]"
                ></span>
              </vscode-button>
            </div>
          </div>
        </form>
      </EventItem>
      <!-- TODO: list committer's email as tooltip -->
      <!-- <div class="grid grid-cols-subgrid gap-x-3 items-center">
        <span
          title="Git commit"
          class="px-[2px] no-underline before:bg-vscode-editor-background codicon codicon-git-commit"
        ></span>
        <div class="flex items-center">
          <pre>Add embeds also to revisions</pre>
          <vscode-button
            class="ml-1"
            appearance="icon"
            title="Show/hide additional commit info"
          >
            <span class="codicon codicon-ellipsis"></span>
          </vscode-button>
        </div>
        <pre title="aed8538aed8538aed8538">aed8538</pre>
        &ndash;
        <pre title="me@sebastinez.dev">Sebastian Martinez</pre>
        <pre>10 hours ago</pre>
      </div> -->
      <template v-for="event in patchEvents" :key="event.ts">
        <EventItem
          v-if="event.kind === 'revision'"
          :when="event.ts"
          codicon="codicon-versions"
        >
          {{ event.revision.id === firstRevision.id ? 'Patch and revision' : 'Revision' }}
          <span
            :title="getRevisionHoverTitle(event.revision.description)"
            class="font-mono hover:cursor-pointer"
            @click="$emit('showRevision', event.revision)"
          >
            {{ shortenHash(event.revision.id) }}
          </span>
          created by
          <span :title="event.revision.author.id" class="font-mono">
            {{ getIdentityAliasOrId(event.revision.author) }}
          </span>
        </EventItem>
        <EventItem
          v-else-if="event.kind === 'review'"
          :when="event.ts"
          :codicon="
            event.review.verdict === 'accept'
              ? 'codicon-thumbsup'
              : event.review.verdict === 'reject'
                ? 'codicon-thumbsdown'
                : 'codicon-feedback'
          "
        >
          Review
          <span v-if="event.review.verdict" class="font-mono">
            {{ `${event.review.verdict}ing` }}
          </span>
          <template v-else>with <span class="font-mono">no verdict</span> for</template>
          <template v-if="patch.revisions.length > 1">
            revision
            <span
              :title="getRevisionHoverTitle(event.revision.description)"
              class="font-mono hover:cursor-pointer"
              @click="$emit('showRevision', event.revision)"
            >
              {{ shortenHash(event.revision.id) }}
            </span>
          </template>
          <template v-else> patch</template>
          posted
          <span v-if="event.review.inline?.length">with code-inlined comments</span>
          by
          <span :title="event.revision.author.id" class="font-mono">
            {{ getIdentityAliasOrId(event.review.author) }}
          </span>
          <template v-if="event.review.summary || event.review.comment">
            <details
              v-if="
                event.review.comment ||
                (event.review.summary?.length ?? 0) > maxCharsForUntruncatedMdText
              "
            >
              <summary
                title="Click to Expand/Collapse"
                class="mt-1 max-w-prose break-words font-mono text-sm"
              >
                {{ truncateMarkdown(event.review.summary ?? event.review.comment ?? '') }}
              </summary>
              <p
                v-if="(event.review.summary?.length ?? 0) > maxCharsForUntruncatedMdText"
                class="max-w-prose break-words font-mono text-sm"
              >
                {{ event.review.summary }}
              </p>
              <Markdown
                v-if="event.review.comment"
                :source="event.review.comment"
                class="mt-[0.25em] text-sm"
              />
            </details>
            <p
              v-else-if="event.review.summary"
              class="mb-[-0.2em] mt-1 max-w-prose break-words font-mono text-sm"
            >
              {{ event.review.summary }}
            </p>
          </template>
        </EventItem>
        <EventItem
          v-else-if="event.kind === 'discussion'"
          :id="event.discussion.id"
          ref="commentRefs"
          :when="event.ts"
          :codicon="
            event.discussion.resolved ? 'codicon-comment' : 'codicon-comment-unresolved'
          "
        >
          Comment
          <span v-if="!event.discussion.resolved">
            (
            <span class="font-mono">unresolved</span>
            )
          </span>
          posted
          <template v-if="patch.revisions.length > 1">
            on revision
            <span
              :title="getRevisionHoverTitle(event.revision.description)"
              class="font-mono hover:cursor-pointer"
              @click="$emit('showRevision', event.revision)"
            >
              {{ shortenHash(event.revision.id) }}
            </span>
          </template>
          by
          <span :title="event.discussion.author.id" class="font-mono">
            {{ getIdentityAliasOrId(event.discussion.author) }}
          </span>
          <span v-if="event.discussion.replyTo">
            in reply to
            <span
              title="Click to Show Parent Comment"
              class="font-mono hover:cursor-pointer"
              @click="scrollToComment(event.discussion.replyTo)"
            >
              another
            </span>
          </span>
          <details v-if="event.discussion.body.length > maxCharsForUntruncatedMdText">
            <summary
              title="Click to Expand/Collapse"
              class="mt-1 max-w-prose font-mono text-sm"
            >
              {{ truncateMarkdown(event.discussion.body) }}
            </summary>
            <Markdown :source="event.discussion.body" class="mt-[0.25em] text-sm" />
          </details>
          <Markdown v-else :source="event.discussion.body" class="mt-[0.25em] text-sm" />
          <Reactions
            v-if="event.discussion.reactions.length"
            :reactions="event.discussion.reactions"
            class="mt-[0.25em]"
          />
        </EventItem>
        <EventItem
          v-else-if="event.kind === 'merge'"
          :when="event.ts"
          codicon="codicon-git-merge"
        >
          Patch merged by
          <span :title="event.merge.author.id" class="font-mono">
            {{ getIdentityAliasOrId(event.merge.author) }}
          </span>
          <template v-if="patch.revisions.length > 1">
            using revision
            <span
              v-if="event.revision"
              :title="getRevisionHoverTitle(event.revision.description)"
              class="font-mono hover:cursor-pointer"
              @click="$emit('showRevision', event.revision)"
            >
              {{ shortenHash(event.revision.id) }}
            </span>
            <span v-else class="font-mono">{{ shortenHash(event.merge.revision) }}</span>
          </template>
        </EventItem>
      </template>
    </EventList>
  </section>
</template>

<style scoped>
.reset-font {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

/* eslint-disable vue-scoped-css/require-selector-used-inside */
vscode-text-field::part(control),
vscode-text-area::part(control) {
  @apply font-mono text-sm;
  field-sizing: content;
  max-height: min(80ch, 65vh);
  word-break: break-word;
}

vscode-text-field::part(label),
vscode-text-area::part(label) {
  margin-bottom: 0.5em;
}

.pulse-outline,
:deep(.pulse-outline) {
  @keyframes outline-pulse {
    from {
      @apply outline-transparent;
    }
    25% {
      @apply outline-vscode-editor-foreground;
    }
    50% {
      @apply outline-transparent;
    }
    70% {
      @apply outline-vscode-editor-foreground;
    }
    to {
      @apply outline-transparent;
    }
  }

  @keyframes outline-pulse-static {
    from {
      @apply outline-vscode-editor-foreground;
    }
    to {
      @apply outline-vscode-editor-foreground;
    }
  }

  @apply outline outline-offset-[0.25em];

  @media (prefers-reduced-motion: no-preference) {
    animation: outline-pulse 1000ms ease-in-out forwards;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: outline-pulse-static 1000ms ease-in-out forwards;
  }
}
/* eslint-enable vue-scoped-css/require-selector-used-inside */
</style>
