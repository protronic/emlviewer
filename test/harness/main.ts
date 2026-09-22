import {createApp, defineComponent, h, ref} from 'vue';
import type {Resource, SpaceResource} from '@opencloud-eu/web-client';
import App from '../../src/App.vue';
import {ocContext} from '../../src/ocContext';
import sampleEml from '../fixtures/sample.eml?raw';

type HarnessState = {
  saves: Array<{space: string | null; path: string; size: number}>;
  prints: string[];
  errors: string[];
};

declare global {
  interface Window {
    __harness: HarnessState;
    __loadMessage: (raw: string) => void;
  }
}

window.__harness = {saves: [], prints: [], errors: []};

window.addEventListener('error', (event) => {
  window.__harness.errors.push(String(event.error ?? event.message));
});
window.addEventListener('unhandledrejection', (event) => {
  window.__harness.errors.push(String(event.reason));
});

// Mocks the OpenCloud WebDAV bridge: "Save to OpenCloud" must land here. A
// second save of the same path fails like a PUT with overwrite:false.
ocContext.saveSibling = async (space, path, content) => {
  if (window.__harness.saves.some((save) => save.path === path)) {
    throw new Error(`exists: ${path}`);
  }
  window.__harness.saves.push({
    space: (space as {id?: string})?.id ?? null,
    path,
    size: content.byteLength,
  });
};

// Intercepts the print frame: records its document instead of opening the
// native print dialog.
ocContext.printHook = (frame) => {
  window.__harness.prints.push(frame.srcdoc);
  frame.remove();
  return true;
};

// The AppWrapper hands the file over as ArrayBuffer (responseType: 'arraybuffer').
const encode = (raw: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(raw);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const currentContent = ref<ArrayBuffer | null>(encode(sampleEml));
const resource = ref({
  id: 'res-eml-1',
  name: 'message.eml',
  path: '/mail/message.eml',
  size: sampleEml.length,
  extension: 'eml',
  mimeType: 'message/rfc822',
} as unknown as Resource);
const space = {id: 'space-1', name: 'Testspace'} as unknown as SpaceResource;

const Host = defineComponent({
  setup() {
    return () =>
      h(App, {
        currentContent: currentContent.value,
        isReadOnly: true,
        resource: resource.value,
        space,
      });
  },
});

createApp(Host).mount('#host');

window.__loadMessage = (raw: string) => {
  resource.value = {...resource.value, id: `res-${Date.now()}`} as unknown as Resource;
  currentContent.value = encode(raw);
};
