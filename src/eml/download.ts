import type {EmlAttachment} from './parse';

export function downloadAttachment(attachment: EmlAttachment): void {
  const blob = new Blob([attachment.content as BlobPart], {type: attachment.mimeType});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = attachment.filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Prints a complete HTML document through a hidden, script-less iframe.
 * The frame is same-origin so print() can be called on it, and it stays in
 * the DOM until the print dialog closes (afterprint) or a fallback timeout.
 * `beforePrint` may intercept the frame (test hook); returning true skips
 * the native print() call.
 */
export function printDocument(
  html: string,
  beforePrint?: (frame: HTMLIFrameElement) => boolean,
): void {
  const frame = document.createElement('iframe');
  frame.className = 'emlviewer-print-frame';
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.left = '-10000px';
  frame.style.top = '0';
  frame.style.width = '800px';
  frame.style.height = '1000px';
  frame.style.border = '0';
  frame.style.opacity = '0';

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };

  frame.addEventListener('load', () => {
    if (beforePrint?.(frame)) return;
    const frameWindow = frame.contentWindow;
    if (!frameWindow) {
      remove();
      return;
    }
    frameWindow.addEventListener('afterprint', () => window.setTimeout(remove, 100));
    window.setTimeout(remove, 120_000);
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch (error) {
      console.error('emlviewer: print failed', error);
      remove();
    }
  });

  frame.srcdoc = html;
  document.body.appendChild(frame);
}
