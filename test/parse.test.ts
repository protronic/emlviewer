import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {formatAddresses, parseEml, safeFilename} from '../src/eml/parse';

const fixture = new Uint8Array(readFileSync(new URL('./fixtures/sample.eml', import.meta.url)));

describe('parseEml', () => {
  it('decodes headers including RFC 2047 encoded words', async () => {
    const message = await parseEml(fixture);
    expect(message.subject).toBe('Testnachricht für den Viewer');
    expect(message.from).toBe('Alice Example <alice@example.com>');
    expect(message.to).toBe('Bob Example <bob@example.org>');
    expect(message.cc).toBe('carol@example.net');
    expect(message.replyTo).toBe('replies@example.com');
    expect(message.messageId).toBe('<sample-1@example.com>');
    expect(message.date?.toISOString()).toBe('2026-09-15T08:30:00.000Z');
  });

  it('exposes both body variants with decoded charsets', async () => {
    const message = await parseEml(fixture);
    expect(message.text).toContain('umlaut: Grüße');
    expect(message.html).toContain('Hello from the <b>HTML part</b>');
    expect(message.html).toContain('umlaut: Grüße');
  });

  it('lists inline, regular and forwarded-message attachments', async () => {
    const message = await parseEml(fixture);
    const names = message.attachments.map((attachment) => attachment.filename);
    expect(names).toEqual(['logo.png', 'report.txt', 'forwarded.eml']);

    const logo = message.attachments[0];
    expect(logo.contentId).toBe('logo@example');
    expect(logo.inline).toBe(true);
    expect(logo.mimeType).toBe('image/png');
    expect(Array.from(logo.content.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const report = message.attachments[1];
    expect(report.inline).toBe(false);
    expect(new TextDecoder().decode(report.content)).toBe('Report line 1\nReport line 2\n');

    const forwarded = message.attachments[2];
    expect(forwarded.mimeType).toBe('message/rfc822');
    expect(new TextDecoder().decode(forwarded.content)).toContain('Subject: Forwarded original');
  });

  it('accepts the message as a string as well', async () => {
    const message = await parseEml(new TextDecoder().decode(fixture));
    expect(message.subject).toBe('Testnachricht für den Viewer');
  });

  it('parses messages without any MIME structure', async () => {
    const message = await parseEml('From: x@example.com\r\nSubject: bare\r\n\r\nJust text.\r\n');
    expect(message.subject).toBe('bare');
    expect(message.text.trim()).toBe('Just text.');
    expect(message.html).toBe('');
    expect(message.attachments).toEqual([]);
  });
});

describe('formatAddresses', () => {
  it('renders names, bare addresses and groups', () => {
    expect(formatAddresses([{name: 'A', address: 'a@x.org'}])).toBe('A <a@x.org>');
    expect(formatAddresses([{name: '', address: 'a@x.org'}])).toBe('a@x.org');
    expect(
      formatAddresses([
        {
          name: 'Team',
          group: [
            {name: 'A', address: 'a@x.org'},
            {name: '', address: 'b@x.org'},
          ],
        },
      ]),
    ).toBe('Team: A <a@x.org>, b@x.org;');
    expect(formatAddresses(undefined)).toBe('');
  });
});

describe('safeFilename', () => {
  it('neutralises path separators and empty names', () => {
    expect(safeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFilename('  report.txt ')).toBe('report.txt');
    expect(safeFilename('..')).toBe('');
    expect(safeFilename('')).toBe('');
  });
});
