import DOMPurify from 'dompurify';
import type {EmlAttachment, EmlMessage} from './parse';

export interface RenderOptions {
  /** Keep http(s) images, backgrounds and CSS url()s. Off by default. */
  allowRemoteContent: boolean;
}

export interface RenderedBody {
  /** <style> blocks that came from the e-mail's <head>. */
  headStyles: string;
  /** Attributes copied from the e-mail's <body> (style, bgcolor, ...). */
  bodyAttrs: string;
  /** Sanitised body markup. */
  bodyInner: string;
  /** Whether the HTML part was used (false: rendered from the text part). */
  usedHtml: boolean;
  /** Remote resources that were stripped because remote content is off. */
  blockedRemote: number;
  /** cid: references that were resolved to an attachment. */
  inlineResolved: number;
}

const FORBID_TAGS = [
  'script',
  'noscript',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'link',
  'meta',
  'base',
  'video',
  'audio',
  'svg',
  'math',
];

const URL_ATTRIBUTES = ['src', 'srcset', 'poster', 'background', 'lowsrc', 'data-src'];
const BODY_ATTRIBUTES = ['style', 'bgcolor', 'text', 'link', 'vlink', 'alink'];
const REMOTE_URL = /^(?:https?:)?\/\//i;
const CSS_REMOTE_URL = /url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi;
const CSS_IMPORT = /@import\b[^;]*;?/gi;
const CSS_CID_URL = /url\(\s*(['"]?)\s*cid:([^'")\s]+)\s*\1\s*\)/gi;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Resolves cid: references to data: URLs; the base64 is computed once per attachment. */
class InlineResolver {
  private readonly byId = new Map<string, EmlAttachment>();
  private readonly cache = new Map<number, string>();
  resolved = 0;

  constructor(attachments: EmlAttachment[]) {
    for (const attachment of attachments) {
      if (attachment.contentId) {
        this.byId.set(attachment.contentId.toLowerCase(), attachment);
      }
      // Some clients reference inline parts by file name instead of Content-ID.
      const nameKey = attachment.filename.toLowerCase();
      if (!this.byId.has(nameKey)) this.byId.set(nameKey, attachment);
    }
  }

  resolve(cid: string): string | undefined {
    let key = cid.trim();
    try {
      key = decodeURIComponent(key);
    } catch {
      // keep the raw value
    }
    const attachment = this.byId.get(key.toLowerCase());
    if (!attachment) return undefined;
    let url = this.cache.get(attachment.index);
    if (!url) {
      url = `data:${attachment.mimeType};base64,${bytesToBase64(attachment.content)}`;
      this.cache.set(attachment.index, url);
    }
    this.resolved += 1;
    return url;
  }
}

function linkify(escapedText: string): string {
  return escapedText.replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)'"])/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
  );
}

function rewriteCss(css: string, resolver: InlineResolver, options: RenderOptions, stats: {blocked: number}): string {
  let result = css.replace(CSS_CID_URL, (match, quote: string, cid: string) => {
    const url = resolver.resolve(cid);
    return url ? `url(${quote}${url}${quote})` : 'none';
  });
  if (!options.allowRemoteContent) {
    result = result.replace(CSS_IMPORT, () => {
      stats.blocked += 1;
      return '';
    });
    result = result.replace(CSS_REMOTE_URL, () => {
      stats.blocked += 1;
      return 'none';
    });
  }
  return result;
}

function rewriteUrlValue(
  value: string,
  resolver: InlineResolver,
  options: RenderOptions,
  stats: {blocked: number},
): string | null {
  const trimmed = value.trim();
  if (/^cid:/i.test(trimmed)) {
    return resolver.resolve(trimmed.slice(4)) ?? null;
  }
  if (/^data:/i.test(trimmed)) return trimmed;
  if (REMOTE_URL.test(trimmed) || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (options.allowRemoteContent) return trimmed;
    stats.blocked += 1;
    return null;
  }
  // Relative URLs have nothing to resolve against inside the viewer.
  stats.blocked += 1;
  return null;
}

function rewriteSrcset(
  value: string,
  resolver: InlineResolver,
  options: RenderOptions,
  stats: {blocked: number},
): string | null {
  const candidates = value
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => {
      const [url, ...descriptor] = candidate.split(/\s+/);
      const rewritten = rewriteUrlValue(url, resolver, options, stats);
      return rewritten ? [rewritten, ...descriptor].join(' ') : null;
    })
    .filter((candidate): candidate is string => candidate !== null);
  return candidates.length ? candidates.join(', ') : null;
}

function rewriteDocument(doc: Document, resolver: InlineResolver, options: RenderOptions): number {
  const stats = {blocked: 0};

  for (const element of Array.from(doc.querySelectorAll<HTMLElement>('*'))) {
    for (const attribute of URL_ATTRIBUTES) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute) ?? '';
      const rewritten =
        attribute === 'srcset'
          ? rewriteSrcset(value, resolver, options, stats)
          : rewriteUrlValue(value, resolver, options, stats);
      if (rewritten === null) {
        element.removeAttribute(attribute);
        element.setAttribute('data-emlviewer-blocked', attribute);
      } else {
        element.setAttribute(attribute, rewritten);
      }
    }
    if (element.hasAttribute('style')) {
      element.setAttribute(
        'style',
        rewriteCss(element.getAttribute('style') ?? '', resolver, options, stats),
      );
    }
    if (element.tagName === 'STYLE') {
      element.textContent = rewriteCss(element.textContent ?? '', resolver, options, stats);
    }
    if (element.tagName === 'A') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  }

  return stats.blocked;
}

function bodyAttributes(body: HTMLElement | null): string {
  if (!body) return '';
  return BODY_ATTRIBUTES.filter((name) => body.hasAttribute(name))
    .map((name) => `${name}="${escapeHtml(body.getAttribute(name) ?? '')}"`)
    .join(' ');
}

/**
 * Turns the message body into sanitised markup: scripts, forms and frames
 * are removed, cid: images are inlined as data: URLs and remote resources
 * are stripped unless allowRemoteContent is set. Falls back to the text
 * part (linkified, in a <pre>) when the message has no HTML part.
 */
export function renderBody(message: EmlMessage, options: RenderOptions): RenderedBody {
  const resolver = new InlineResolver(message.attachments);

  if (!message.html.trim()) {
    const text = message.text.trim();
    return {
      headStyles: '',
      bodyAttrs: '',
      bodyInner: text ? `<pre class="emlviewer-text">${linkify(escapeHtml(text))}</pre>` : '',
      usedHtml: false,
      blockedRemote: 0,
      inlineResolved: 0,
    };
  }

  const purified = DOMPurify.sanitize(message.html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS,
    FORBID_ATTR: ['srcdoc', 'formaction', 'action', 'ping'],
    ALLOW_DATA_ATTR: false,
  });
  const doc = new DOMParser().parseFromString(purified, 'text/html');
  const blockedRemote = rewriteDocument(doc, resolver, options);

  const headStyles = Array.from(doc.head?.querySelectorAll('style') ?? [])
    .map((style) => style.outerHTML)
    .join('\n');

  return {
    headStyles,
    bodyAttrs: bodyAttributes(doc.body),
    bodyInner: doc.body?.innerHTML ?? '',
    usedHtml: true,
    blockedRemote,
    inlineResolved: resolver.resolved,
  };
}

const VIEW_STYLES = `
  html, body { margin: 0; padding: 0; }
  body { padding: 12px 16px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 14px; line-height: 1.45; color: #1f2933; background: #ffffff; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  pre.emlviewer-text { white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
  [data-emlviewer-blocked] { outline: 1px dashed #c0c7d0; min-width: 16px; min-height: 16px; }
`;

/** Complete document for the sandboxed preview iframe (srcdoc). */
export function toSrcdoc(body: RenderedBody): string {
  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8">',
    '<base target="_blank">',
    `<style>${VIEW_STYLES}</style>`,
    body.headStyles,
    '</head>',
    `<body ${body.bodyAttrs}>${body.bodyInner}</body></html>`,
  ].join('\n');
}

export interface PrintLabels {
  from: string;
  to: string;
  cc: string;
  bcc: string;
  replyTo: string;
  date: string;
  subject: string;
  attachments: string;
  noSubject: string;
}

const PRINT_STYLES = `
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 12pt; color: #000; }
  .emlviewer-print-headers { margin: 0 0 14pt 0; padding: 0 0 8pt 0; border-bottom: 1px solid #888; }
  .emlviewer-print-headers table { border-collapse: collapse; font-size: 11pt; }
  .emlviewer-print-headers th { text-align: left; vertical-align: top; padding: 1pt 10pt 1pt 0; font-weight: 600; white-space: nowrap; }
  .emlviewer-print-headers td { padding: 1pt 0; }
  .emlviewer-print-headers h1 { font-size: 15pt; margin: 0 0 6pt 0; }
  img { max-width: 100%; height: auto; }
  pre.emlviewer-text { white-space: pre-wrap; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10.5pt; }
  @page { margin: 15mm; }
`;

/**
 * Printer-friendly document: header block followed by the rendered body,
 * the same layout the Nextcloud app produced for its print/PDF output.
 */
export function toPrintDocument(
  message: EmlMessage,
  body: RenderedBody,
  labels: PrintLabels,
  formattedDate: string,
): string {
  const rows: Array<[string, string]> = [
    [labels.from, message.from],
    [labels.to, message.to],
    [labels.cc, message.cc],
    [labels.bcc, message.bcc],
    [labels.replyTo, message.replyTo],
    [labels.date, formattedDate],
    [labels.attachments, message.attachments.map((attachment) => attachment.filename).join(', ')],
  ];
  const headerRows = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  const title = message.subject.trim() || labels.noSubject;

  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${PRINT_STYLES}</style>`,
    body.headStyles,
    '</head>',
    `<body ${body.bodyAttrs}>`,
    '<div class="emlviewer-print-headers">',
    `<h1>${escapeHtml(title)}</h1>`,
    `<table><tbody>${headerRows}</tbody></table>`,
    '</div>',
    body.bodyInner,
    '</body></html>',
  ].join('\n');
}
