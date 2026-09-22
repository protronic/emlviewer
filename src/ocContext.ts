import type {Resource, SpaceResource} from '@opencloud-eu/web-client';

/**
 * Bridge between the OpenCloud runtime and App.vue. Filled by index.ts when
 * the extension is registered inside OpenCloud; stays empty outside of it
 * (the test harness injects mocks). Kept in its own module so App.vue does
 * not need to import @opencloud-eu/web-pkg, which only exists as a shared
 * module inside the OpenCloud host.
 *
 * saveSibling writes a file (an e-mail attachment) into the folder of the
 * currently opened .eml via WebDAV. It must reject when the target exists.
 * printHook lets a test intercept the print frame; returning true skips the
 * native print() call.
 */
export const ocContext: {
  saveSibling?: (space: SpaceResource, path: string, content: ArrayBuffer) => Promise<void>;
  printHook?: (frame: HTMLIFrameElement) => boolean;
} = {};

export type {Resource, SpaceResource};
