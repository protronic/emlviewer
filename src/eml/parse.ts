import PostalMime, {type Address, type Attachment} from 'postal-mime';

export type RawEmlContent = string | ArrayBuffer | Uint8Array | Blob;

export interface EmlAttachment {
  /** Position in the message's attachment list; used for stable keys. */
  index: number;
  filename: string;
  mimeType: string;
  size: number;
  content: Uint8Array;
  /** Content-ID without the surrounding angle brackets. */
  contentId?: string;
  /** Part is meant to be embedded in the HTML body (cid: reference). */
  inline: boolean;
}

export interface EmlMessage {
  subject: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  replyTo: string;
  date?: Date;
  dateRaw: string;
  messageId: string;
  text: string;
  html: string;
  attachments: EmlAttachment[];
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'message/rfc822': 'eml',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/calendar': 'ics',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
};

export function formatAddress(address: Address): string {
  if (address.group) {
    const members = address.group.map(formatAddress).filter(Boolean).join(', ');
    return `${address.name}: ${members};`;
  }
  const name = (address.name ?? '').trim();
  const mail = (address.address ?? '').trim();
  if (name && mail && name !== mail) return `${name} <${mail}>`;
  return mail || name;
}

export function formatAddresses(list: Address[] | Address | undefined): string {
  if (!list) return '';
  const addresses = Array.isArray(list) ? list : [list];
  return addresses.map(formatAddress).filter(Boolean).join(', ');
}

export function toUint8Array(content: Attachment['content'] | undefined): Uint8Array {
  if (!content) return new Uint8Array(0);
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return new TextEncoder().encode(content);
}

function normalizeContentId(contentId: string | undefined): string | undefined {
  if (!contentId) return undefined;
  const trimmed = contentId.trim().replace(/^<|>$/g, '').trim();
  return trimmed || undefined;
}

function fallbackFilename(index: number, mimeType: string): string {
  const extension = EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? 'bin';
  return `attachment-${index + 1}.${extension}`;
}

/** Strips path separators and control characters from a sender-supplied name. */
export function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return '';
  return cleaned;
}

function mapAttachment(attachment: Attachment, index: number): EmlAttachment {
  const content = toUint8Array(attachment.content);
  const mimeType = (attachment.mimeType || 'application/octet-stream').toLowerCase();
  const contentId = normalizeContentId(attachment.contentId);
  const filename = safeFilename(attachment.filename ?? '') || fallbackFilename(index, mimeType);
  return {
    index,
    filename,
    mimeType,
    size: content.byteLength,
    content,
    contentId,
    inline: Boolean(contentId) && (attachment.disposition === 'inline' || attachment.related === true),
  };
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Parses a raw RFC 822 message into the structure the viewer renders.
 * Nested message/rfc822 parts stay attachments (like the original
 * Nextcloud app listed them) instead of being merged into the body.
 */
export async function parseEml(raw: RawEmlContent): Promise<EmlMessage> {
  const email = await PostalMime.parse(raw, {
    rfc822Attachments: true,
    attachmentEncoding: 'arraybuffer',
  });

  return {
    subject: email.subject ?? '',
    from: formatAddresses(email.from),
    to: formatAddresses(email.to),
    cc: formatAddresses(email.cc),
    bcc: formatAddresses(email.bcc),
    replyTo: formatAddresses(email.replyTo),
    date: parseDate(email.date),
    dateRaw: email.date ?? '',
    messageId: email.messageId ?? '',
    text: email.text ?? '',
    html: email.html ?? '',
    attachments: email.attachments.map(mapAttachment),
  };
}
