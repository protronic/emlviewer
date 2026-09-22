# Eml Viewer for OpenCloud

An [OpenCloud](https://opencloud.eu) web extension that previews `.eml`
e-mail files (`message/rfc822`) directly in the browser: headers, HTML or
plain text body, attachments, print and PDF export.

This is the OpenCloud port of the [Nextcloud Eml Viewer](https://github.com/newroco/emlviewer)
app by newroco. The Nextcloud version parsed messages on the server (PHP,
mail-mime-parser, mPDF). OpenCloud extensions have no server side, so this
port does everything client-side:

| Nextcloud app                          | OpenCloud extension                                   |
|----------------------------------------|-------------------------------------------------------|
| PHP `PageController` + mail-mime-parser | [postal-mime](https://github.com/postalsys/postal-mime) in the browser |
| PHP templates, `srcdoc` iframe         | Sanitised (DOMPurify) markup in a sandboxed `srcdoc` iframe |
| `cid:` images base64-inlined server-side | `cid:` images inlined as `data:` URLs client-side    |
| `Download as PDF` via mPDF             | Printer-friendly document + browser print dialog ("Save as PDF") |
| Attachment download route              | Attachment download (Blob) and "Save to OpenCloud" (WebDAV, next to the `.eml`) |
| Nextcloud file action "View"           | Registered as default app for `.eml` / `message/rfc822` |

## Features

- Opens `.eml` files from the file list (default app, "Open with Eml Viewer")
- From / To / Cc / Bcc / Reply-To / Date / Subject with RFC 2047 decoding
- HTML body rendered in a script-less sandboxed iframe: scripts, forms,
  frames, objects and event handlers are stripped with DOMPurify
- Inline (`cid:`) images and CSS references are resolved from the message's
  own parts; nothing is fetched from the network
- Remote content (http/https images, backgrounds, `@import`) is blocked by
  default with a counter and a "Load remote content" toggle
- Plain text alternative can be shown next to the HTML part; text-only
  messages are rendered (linkified) as body
- Attachments (including forwarded `message/rfc822` parts) with size,
  download and "Save to OpenCloud" into the folder of the opened e-mail
  (never overwrites an existing file)
- Print / PDF: builds a printer-friendly document (header block + body) and
  opens the browser's print dialog; choose "Save as PDF" there
- UI in English or German (browser language)
- About dialog with version, git commit and build time

## Development

Requirements: Node 22+, pnpm 10.

```sh
pnpm install
pnpm build          # production build to dist/web (manifest.json + js/)
pnpm check:types    # vue-tsc
pnpm test           # vitest unit tests (MIME parsing)
pnpm check          # build + types + unit tests
```

### Browser smoke test

The harness mounts `src/App.vue` the same way the OpenCloud `AppWrapper`
does (without Module Federation) and drives it with Playwright against
`test/fixtures/sample.eml`:

```sh
pnpm harness                       # vite dev server on port 5302
pnpm harness:run                   # in a second terminal
# HARNESS_CHROMIUM=/path/to/chromium pnpm harness:run  (default: /opt/pw-browsers/chromium)
```

It checks header rendering, sanitisation (scripts, iframes, event handlers),
inlined `cid:` images, blocked / re-enabled remote content, the text
toggle, attachment download, "Save to OpenCloud" (incl. the conflict case)
and the print document.

## Deployment with opencloud-compose

The extension is a standalone submodule of
[protronic/opencloud-compose](https://github.com/protronic/opencloud-compose)
(`web-app-submodules/emlviewer`). From the compose repository root:

```sh
git submodule update --init --recursive
./web-app-submodules/build-web-extensions.sh emlviewer
docker compose restart opencloud
```

or add `emlviewer` to `OC_WEB_APPS` in `.env` and run the build script
without arguments. The build output `dist/web` is copied to
`OC_APPS_DIR/emlviewer/` and served by OpenCloud from
`/assets/apps/emlviewer/`.

Manual deployment: copy `dist/web/` to `<OC_APPS_DIR>/emlviewer/` of an
OpenCloud instance and restart the container.

### Content Security Policy

The preview is an `srcdoc` iframe and inherits OpenCloud's CSP. The default
`csp.yaml` of opencloud-compose already allows `data:` and `blob:` images,
which is all the viewer needs. "Load remote content" additionally depends on
`img-src` permitting the remote hosts; with the default policy such images
stay blocked by the browser.

## Compatibility

Built with `@opencloud-eu/extension-sdk` 7.1.2 (Module Federation runtime
2.3.x) for OpenCloud Web 7.2+ / OpenCloud 8, matching the other extensions
in opencloud-compose.

## License

AGPL-3.0-or-later, see [COPYING](COPYING). Derived from the Nextcloud
Eml Viewer by [newroco](https://github.com/newroco/emlviewer).
