<template>
  <div class="emlviewer">
    <header class="toolbar">
      <span class="app-label">{{ L.appLabel }}</span>
      <span class="separator" aria-hidden="true" />
      <span class="subject-title" :title="title">{{ title }}</span>
      <span class="spacer" />
      <span v-if="notice" class="status-hint" :class="{error: noticeIsError}">{{ notice }}</span>
      <button
        v-if="message && message.text && body?.usedHtml"
        type="button"
        class="tb-btn-text"
        @click="showText = !showText"
      >
        {{ showText ? L.hideText : L.showText }}
      </button>
      <button
        v-if="body && (body.blockedRemote > 0 || allowRemote)"
        type="button"
        class="tb-btn-text"
        :class="{active: allowRemote}"
        @click="allowRemote = !allowRemote"
      >
        {{ allowRemote ? L.blockRemote : L.loadRemote(body.blockedRemote) }}
      </button>
      <button
        type="button"
        class="tb-btn-text"
        :title="L.printTitle"
        :disabled="!message"
        @click="print"
      >
        {{ L.print }}
      </button>
      <button
        type="button"
        class="tb-btn-text"
        :title="L.pdfTitle"
        :disabled="!message"
        @click="print"
      >
        {{ L.pdf }}
      </button>
      <button
        type="button"
        class="tb-btn-text"
        :title="L.about"
        :aria-label="L.about"
        @click="aboutOpen = true"
      >
        ⓘ
      </button>
    </header>

    <main class="content">
      <div v-if="parseError" class="error-banner">{{ parseError }}</div>
      <div v-else-if="!message" class="boot-hint">
        <span class="boot-spinner" aria-hidden="true" />
        <span>{{ L.loading }}</span>
      </div>
      <template v-else>
        <section class="mail-headers">
          <table>
            <tbody>
              <tr v-for="row in headerRows" :key="row.label">
                <th>{{ row.label }}</th>
                <td>{{ row.value }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-if="message.attachments.length" class="attachments">
          <span class="attachments-label">
            {{ L.attachments }} ({{ message.attachments.length }})
          </span>
          <div
            v-for="attachment in message.attachments"
            :key="attachment.index"
            class="attachment"
            :class="{inline: attachment.inline}"
            :title="attachment.inline ? L.inlineAttachment : attachment.mimeType"
          >
            <span class="attachment-name">{{ attachment.filename }}</span>
            <span class="attachment-size">{{ formatSize(attachment.size) }}</span>
            <button type="button" class="tb-btn-text" @click="download(attachment)">
              {{ L.download }}
            </button>
            <button
              v-if="canSaveToCloud"
              type="button"
              class="tb-btn-text"
              :title="L.saveToCloudTitle"
              :disabled="saving.has(attachment.index)"
              @click="saveToCloud(attachment)"
            >
              {{ L.saveToCloud }}
            </button>
          </div>
        </section>

        <section v-if="showText && message.text" class="text-content">
          <pre>{{ message.text }}</pre>
        </section>

        <section class="body-pane">
          <div v-if="!body || !body.bodyInner" class="empty-hint">{{ L.noContent }}</div>
          <iframe
            v-else
            class="mail-body"
            :srcdoc="srcdoc"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerpolicy="no-referrer"
            :title="L.message"
          />
        </section>
      </template>

      <div v-if="aboutOpen" class="about-backdrop" @pointerdown.self="aboutOpen = false">
        <div class="about-dialog" role="dialog" :aria-label="L.about">
          <h2>Eml Viewer</h2>
          <dl>
            <dt>{{ L.version }}</dt>
            <dd>{{ aboutInfo.version }}</dd>
            <dt>{{ L.commit }}</dt>
            <dd class="mono">{{ aboutInfo.commit }}</dd>
            <dt>{{ L.build }}</dt>
            <dd>{{ aboutInfo.buildTime }}</dd>
          </dl>
          <div class="about-actions">
            <button type="button" @click="aboutOpen = false">{{ L.close }}</button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import type {Resource, SpaceResource} from '@opencloud-eu/web-client';
import {ocContext} from './ocContext';
import {downloadAttachment, printDocument} from './eml/download';
import {labelsFor} from './eml/i18n';
import {parseEml, type EmlAttachment, type EmlMessage, type RawEmlContent} from './eml/parse';
import {renderBody, toPrintDocument, toSrcdoc, type RenderedBody} from './eml/render';

type ContentValue = RawEmlContent | null | undefined;

const props = withDefaults(
  defineProps<{
    currentContent: ContentValue;
    isReadOnly?: boolean;
    resource: Resource;
    space?: SpaceResource;
  }>(),
  {isReadOnly: true, space: undefined},
);

const language = typeof navigator === 'undefined' ? 'en' : navigator.language;
const L = labelsFor(language);

const aboutInfo = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  buildTime: new Date(__APP_BUILD_TIME__).toLocaleString(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
};

const message = ref<EmlMessage | null>(null);
const parseError = ref('');
const showText = ref(false);
const allowRemote = ref(false);
const aboutOpen = ref(false);
const notice = ref('');
const noticeIsError = ref(false);
const saving = ref(new Set<number>());

let parseRun = 0;
let noticeTimer = 0;

const title = computed(() => {
  if (!message.value) return props.resource?.name ?? '';
  return message.value.subject.trim() || L.noSubject;
});

const formattedDate = computed(() => {
  if (!message.value) return '';
  if (message.value.date) {
    return message.value.date.toLocaleString(language, {dateStyle: 'full', timeStyle: 'short'});
  }
  return message.value.dateRaw;
});

const headerRows = computed(() => {
  if (!message.value) return [];
  const rows: Array<{label: string; value: string}> = [
    {label: L.from, value: message.value.from},
    {label: L.to, value: message.value.to},
    {label: L.cc, value: message.value.cc},
    {label: L.bcc, value: message.value.bcc},
    {label: L.replyTo, value: message.value.replyTo},
    {label: L.date, value: formattedDate.value},
    {label: L.subject, value: message.value.subject.trim() || L.noSubject},
  ];
  return rows.filter((row) => row.value);
});

const body = computed<RenderedBody | null>(() => {
  if (!message.value) return null;
  return renderBody(message.value, {allowRemoteContent: allowRemote.value});
});

const srcdoc = computed(() => (body.value ? toSrcdoc(body.value) : ''));

const canSaveToCloud = computed(
  () => Boolean(ocContext.saveSibling) && Boolean(props.space) && Boolean(props.resource?.path),
);

function showNotice(text: string, isError = false): void {
  notice.value = text;
  noticeIsError.value = isError;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice.value = '';
  }, 6000);
}

async function load(content: ContentValue): Promise<void> {
  const run = ++parseRun;
  parseError.value = '';
  if (content === null || content === undefined) {
    message.value = null;
    return;
  }
  try {
    const parsed = await parseEml(content);
    if (run !== parseRun) return;
    message.value = parsed;
  } catch (error) {
    if (run !== parseRun) return;
    message.value = null;
    parseError.value = L.parseError(error instanceof Error ? error.message : String(error));
  }
}

watch(
  () => props.currentContent,
  (content) => {
    void load(content);
  },
  {immediate: true},
);

// A different file resets the per-message view state.
watch(
  () => props.resource?.id,
  () => {
    showText.value = false;
    allowRemote.value = false;
  },
);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function download(attachment: EmlAttachment): void {
  downloadAttachment(attachment);
}

function siblingPath(filename: string): string {
  const path = props.resource?.path ?? '';
  const slash = path.lastIndexOf('/');
  const folder = slash >= 0 ? path.slice(0, slash) : '';
  return `${folder}/${filename}`;
}

async function saveToCloud(attachment: EmlAttachment): Promise<void> {
  if (!ocContext.saveSibling || !props.space) return;
  const path = siblingPath(attachment.filename);
  saving.value = new Set([...saving.value, attachment.index]);
  try {
    const content = attachment.content.buffer.slice(
      attachment.content.byteOffset,
      attachment.content.byteOffset + attachment.content.byteLength,
    ) as ArrayBuffer;
    await ocContext.saveSibling(props.space, path, content);
    showNotice(L.saved(path));
  } catch (error) {
    console.error('emlviewer: saving attachment failed', error);
    showNotice(L.saveFailed(attachment.filename), true);
  } finally {
    const next = new Set(saving.value);
    next.delete(attachment.index);
    saving.value = next;
  }
}

function print(): void {
  if (!message.value || !body.value) return;
  const html = toPrintDocument(message.value, body.value, L, formattedDate.value);
  printDocument(html, ocContext.printHook);
}

onBeforeUnmount(() => {
  window.clearTimeout(noticeTimer);
});
</script>

<style scoped>
.emlviewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--oc-role-surface, #f5f6f8);
  color: var(--oc-role-on-surface, #1f2933);
  font-size: 14px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--oc-role-outline-variant, #d9dde3);
  background: var(--oc-role-surface-container, #ffffff);
  flex: 0 0 auto;
  min-height: 42px;
}

.app-label {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #b5473c;
}

.separator {
  width: 1px;
  height: 20px;
  background: var(--oc-role-outline-variant, #d9dde3);
}

.subject-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  min-width: 0;
}

.spacer {
  flex: 1;
}

.status-hint {
  font-size: 12px;
  color: var(--oc-role-on-surface-variant, #5b6572);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
}

.status-hint.error {
  color: #b42318;
}

.tb-btn-text {
  border: 1px solid var(--oc-role-outline-variant, #d9dde3);
  background: var(--oc-role-surface-container-high, #f0f2f5);
  color: inherit;
  border-radius: 6px;
  padding: 4px 10px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.tb-btn-text:hover:not(:disabled) {
  background: var(--oc-role-surface-container-highest, #e4e8ee);
}

.tb-btn-text:disabled {
  opacity: 0.5;
  cursor: default;
}

.tb-btn-text.active {
  border-color: #b5473c;
}

.content {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.error-banner {
  margin: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  background: #fde8e6;
  color: #7a271a;
}

.boot-hint,
.empty-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px;
  color: var(--oc-role-on-surface-variant, #5b6572);
}

.boot-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #c0c7d0;
  border-top-color: #b5473c;
  border-radius: 50%;
  animation: emlviewer-spin 0.9s linear infinite;
}

@keyframes emlviewer-spin {
  to {
    transform: rotate(360deg);
  }
}

.mail-headers {
  padding: 10px 16px 6px;
  flex: 0 0 auto;
}

.mail-headers table {
  border-collapse: collapse;
}

.mail-headers th {
  text-align: left;
  vertical-align: top;
  padding: 1px 12px 1px 0;
  font-weight: 600;
  white-space: nowrap;
  color: var(--oc-role-on-surface-variant, #5b6572);
}

.mail-headers td {
  padding: 1px 0;
  overflow-wrap: anywhere;
}

.attachments {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 16px 10px;
  flex: 0 0 auto;
}

.attachments-label {
  font-weight: 600;
  color: var(--oc-role-on-surface-variant, #5b6572);
}

.attachment {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid var(--oc-role-outline-variant, #d9dde3);
  border-radius: 8px;
  background: var(--oc-role-surface-container, #ffffff);
}

.attachment.inline {
  border-style: dashed;
}

.attachment-name {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-size {
  font-size: 12px;
  color: var(--oc-role-on-surface-variant, #5b6572);
}

.text-content {
  margin: 0 16px 10px;
  padding: 10px 12px;
  border: 1px solid var(--oc-role-outline-variant, #d9dde3);
  border-radius: 6px;
  background: var(--oc-role-surface-container, #ffffff);
  max-height: 40%;
  overflow: auto;
  flex: 0 0 auto;
}

.text-content pre {
  margin: 0;
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
}

.body-pane {
  display: flex;
  flex: 1 1 auto;
  min-height: 300px;
  margin: 0 16px 16px;
  border: 1px solid var(--oc-role-outline-variant, #d9dde3);
  border-radius: 6px;
  background: #ffffff;
  overflow: hidden;
}

.mail-body {
  flex: 1;
  width: 100%;
  height: 100%;
  border: 0;
  background: #ffffff;
}

.about-backdrop {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 24, 30, 0.35);
  z-index: 10;
}

.about-dialog {
  min-width: 300px;
  padding: 18px 22px;
  border-radius: 10px;
  background: var(--oc-role-surface-container, #ffffff);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
}

.about-dialog h2 {
  margin: 0 0 10px;
  font-size: 17px;
}

.about-dialog dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 14px;
  margin: 0 0 14px;
}

.about-dialog dt {
  color: var(--oc-role-on-surface-variant, #5b6572);
}

.about-dialog dd {
  margin: 0;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.about-actions {
  text-align: right;
}

.about-actions button {
  border: 1px solid var(--oc-role-outline-variant, #d9dde3);
  background: var(--oc-role-surface-container-high, #f0f2f5);
  border-radius: 6px;
  padding: 5px 12px;
  font: inherit;
  cursor: pointer;
}
</style>
