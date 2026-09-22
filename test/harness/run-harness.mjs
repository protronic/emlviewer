#!/usr/bin/env node
// Browser smoke test for the OpenCloud integration of src/App.vue.
//
// Prerequisites: `pnpm exec vite --config vite.harness.config.ts` (port 5302)
// and a Chromium binary (defaults to the Playwright-managed install).
//
// Drives the real UI against test/fixtures/sample.eml: headers, sanitised
// HTML body with inlined cid: image, blocked remote content, text toggle,
// attachment download, "Save to OpenCloud" and the print document.
import {chromium} from 'playwright-core';

const browser = await chromium.launch({
  executablePath: process.env.HARNESS_CHROMIUM ?? '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({viewport: {width: 1280, height: 900}, acceptDownloads: true});
const consoleLines = [];
page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

const problems = [];
const check = (condition, message) => {
  if (!condition) problems.push(message);
};

try {
  await page.goto('http://localhost:5302/', {waitUntil: 'networkidle'});

  // 1. Headers are decoded and rendered.
  await page.waitForSelector('.mail-headers', {timeout: 30000});
  const headers = await page.textContent('.mail-headers');
  check(headers.includes('Alice Example <alice@example.com>'), 'From header should be rendered');
  check(headers.includes('Bob Example <bob@example.org>'), 'To header should be rendered');
  check(headers.includes('carol@example.net'), 'Cc header should be rendered');
  check(headers.includes('Testnachricht für den Viewer'), 'Subject should be decoded (RFC 2047)');
  const title = await page.textContent('.subject-title');
  check(title.includes('Testnachricht für den Viewer'), 'toolbar should show the subject');

  // 2. The HTML body is sandboxed, sanitised and has the cid: image inlined.
  const frame = page.frameLocator('iframe.mail-body');
  await frame.locator('body').waitFor({timeout: 30000});
  const bodyText = await frame.locator('body').textContent();
  check(bodyText.includes('Hello from the HTML part'), 'HTML body should be rendered');
  check(bodyText.includes('Grüße'), 'HTML body should decode the charset');
  check(!bodyText.includes('alert'), 'script content must not appear in the body');
  check((await frame.locator('script').count()) === 0, 'script tags must be stripped');
  check((await frame.locator('iframe').count()) === 0, 'nested iframes must be stripped');
  const onclick = await frame.locator('p.brand').getAttribute('onclick');
  check(onclick === null, 'event handler attributes must be stripped');
  const logoSrc = await frame.locator('img[alt="logo"]').getAttribute('src');
  check(logoSrc?.startsWith('data:image/png;base64,'), `cid: image should be inlined, got ${logoSrc}`);
  const trackerSrc = await frame.locator('img[alt="tracker"]').getAttribute('src');
  check(trackerSrc === null, `remote image should be blocked by default, got ${trackerSrc}`);
  const styleText = await frame.locator('style').last().textContent();
  check(!styleText.includes('cdn.example.com'), 'remote CSS url() should be stripped');
  const linkTarget = await frame.locator('a').first().getAttribute('target');
  check(linkTarget === '_blank', 'links should open in a new tab');
  const sandbox = await page.getAttribute('iframe.mail-body', 'sandbox');
  check(sandbox && !sandbox.includes('allow-scripts'), 'body frame must not allow scripts');

  // 3. Remote content can be enabled on demand and blocked again.
  const remoteButton = page.locator('button:has-text("Load remote content")');
  const remoteLabel = await remoteButton.textContent();
  check(remoteLabel.includes('(2 blocked)'), `expected 2 blocked remote resources, got "${remoteLabel}"`);
  await remoteButton.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('iframe.mail-body')
        ?.getAttribute('srcdoc')
        ?.includes('https://tracker.example.com/pixel.gif'),
    null,
    {timeout: 10000},
  );
  await page.click('button:has-text("Block remote content")');
  await page.waitForFunction(
    () =>
      !document
        .querySelector('iframe.mail-body')
        ?.getAttribute('srcdoc')
        ?.includes('https://tracker.example.com/pixel.gif'),
    null,
    {timeout: 10000},
  );

  // 4. The plain text alternative can be toggled.
  check((await page.locator('.text-content').count()) === 0, 'text part hidden by default');
  await page.click('button:has-text("Show text version")');
  await page.waitForSelector('.text-content pre', {timeout: 5000});
  const text = await page.textContent('.text-content pre');
  check(text.includes('plain text part'), 'text part should be shown after toggle');
  await page.click('button:has-text("Hide text version")');
  await page.waitForSelector('.text-content', {state: 'detached', timeout: 5000});

  // 5. Attachments are listed with download and save actions.
  const attachmentNames = await page.locator('.attachment-name').allTextContents();
  check(
    JSON.stringify(attachmentNames) === JSON.stringify(['logo.png', 'report.txt', 'forwarded.eml']),
    `unexpected attachment list: ${attachmentNames.join(', ')}`,
  );
  const [download] = await Promise.all([
    page.waitForEvent('download', {timeout: 10000}),
    page.click('.attachment:has-text("report.txt") button:has-text("Download")'),
  ]);
  check(download.suggestedFilename() === 'report.txt', `download name: ${download.suggestedFilename()}`);
  const downloadPath = await download.path();
  const {readFileSync} = await import('node:fs');
  check(
    readFileSync(downloadPath, 'utf8') === 'Report line 1\nReport line 2\n',
    'downloaded attachment content should match',
  );

  await page.click('.attachment:has-text("report.txt") button:has-text("Save to OpenCloud")');
  await page.waitForFunction(() => window.__harness.saves.length > 0, null, {timeout: 10000});
  const save = await page.evaluate(() => window.__harness.saves.at(-1));
  check(save.path === '/mail/report.txt', `attachment should be saved next to the eml, got ${save.path}`);
  check(save.size === 28, `saved size should be 28 bytes, got ${save.size}`);
  check(save.space === 'space-1', 'save should use the current space');
  await page.waitForSelector('.status-hint:has-text("Saved as /mail/report.txt")', {timeout: 5000});

  // Saving again must surface the conflict instead of overwriting silently.
  await page.click('.attachment:has-text("report.txt") button:has-text("Save to OpenCloud")');
  await page.waitForSelector('.status-hint.error', {timeout: 5000});

  // 6. Print / PDF build the printer-friendly document (headers + body).
  await page.click('button[title^="Printer friendly"]');
  await page.waitForFunction(() => window.__harness.prints.length > 0, null, {timeout: 10000});
  const printed = await page.evaluate(() => window.__harness.prints.at(-1));
  check(printed.includes('Alice Example &lt;alice@example.com&gt;'), 'print document should carry the From header');
  check(printed.includes('Hello from the'), 'print document should carry the body');
  check(!printed.includes('<script'), 'print document must not contain scripts');
  check(printed.includes('report.txt, forwarded.eml'), 'print document should list attachments');
  await page.click('button[title^="Export as PDF"]');
  await page.waitForFunction(() => window.__harness.prints.length > 1, null, {timeout: 10000});
  check(
    (await page.locator('iframe.emlviewer-print-frame').count()) === 0,
    'print frame should be removed after printing',
  );

  // 7. A text-only message renders the text part as body.
  await page.evaluate(() =>
    window.__loadMessage(
      'From: only@example.com\r\nSubject: text only\r\n\r\nPlain body with https://example.org/x link.\r\n',
    ),
  );
  await page.waitForSelector('.subject-title:has-text("text only")', {timeout: 10000});
  const textFrame = page.frameLocator('iframe.mail-body');
  await textFrame.locator('pre.emlviewer-text').waitFor({timeout: 10000});
  check(
    (await textFrame.locator('pre.emlviewer-text a').getAttribute('href')) === 'https://example.org/x',
    'text-only body should be linkified',
  );
  check((await page.locator('button:has-text("Show text version")').count()) === 0, 'text toggle hidden for text-only mail');

  // 8. Garbage input surfaces an error banner instead of a blank page.
  await page.evaluate(() => window.__loadMessage(''));
  await page.waitForFunction(
    () => document.querySelector('.error-banner') || document.querySelector('.empty-hint'),
    null,
    {timeout: 10000},
  );

  const harnessErrors = await page.evaluate(() => window.__harness.errors);
  check(harnessErrors.length === 0, `page errors: ${harnessErrors.join(' | ')}`);
} catch (error) {
  problems.push(`harness threw: ${error?.stack ?? error}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.error('Harness FAILED:');
  for (const problem of problems) console.error(` - ${problem}`);
  console.error('\nBrowser console:');
  for (const line of consoleLines) console.error(`  ${line}`);
  process.exit(1);
}

console.log('Harness OK');
