// PRD §9.2 step 3 — full-page screenshot capture via Playwright.
// Lazy-loads the playwright module so deployments that don't enable
// SCREENSHOTS_ENABLED don't pay the install or runtime cost.
//
// The visible-text extraction is used by the verification step to do
// the equivalent of human "compare snapshot to research output" — we
// check whether the source row's raw_excerpt (or the skill's quoted
// passages) is findable in the page's actual rendered text. Catches
// cases where the model fetched the right URL but the page changed
// or the text was wrong.

import { env } from '../env.js';

export interface SnapshotResult {
  pngBuffer: Buffer;
  visibleText: string;
  finalUrl: string;
  contentSha: string;
}

let _browserPromise: Promise<unknown> | null = null;

async function getBrowser(): Promise<unknown | null> {
  if (env.SCREENSHOTS_ENABLED !== 'true') return null;
  if (_browserPromise) return _browserPromise;
  _browserPromise = (async () => {
    try {
      const pw = (await import('playwright')) as unknown as {
        chromium: { launch: (opts: { headless: boolean }) => Promise<unknown> };
      };
      return await pw.chromium.launch({ headless: true });
    } catch (err) {
      console.warn('playwright_snapshot: playwright not installed', { err: String(err) });
      return null;
    }
  })();
  return _browserPromise;
}

import { createHash } from 'node:crypto';

export async function capturePageSnapshot(url: string): Promise<SnapshotResult | null> {
  const browser = (await getBrowser()) as {
    newContext: (opts: Record<string, unknown>) => Promise<unknown>;
  } | null;
  if (!browser) return null;

  // Each capture gets its own context to keep cookies + storage state
  // isolated. Mirrors a fresh-incognito read every time.
  const context = (await browser.newContext({
    userAgent: 'LegalTeamOS-Snapshot/1.0 (+https://legalbuilder.app)',
    viewport: { width: 1440, height: 900 },
    bypassCSP: true,
  })) as {
    newPage: () => Promise<unknown>;
    close: () => Promise<void>;
  };

  try {
    const page = (await context.newPage()) as {
      goto: (u: string, opts: Record<string, unknown>) => Promise<{ url: () => string } | null>;
      url: () => string;
      screenshot: (opts: Record<string, unknown>) => Promise<Buffer>;
      evaluate: (fn: string) => Promise<string>;
      close: () => Promise<void>;
    };
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });

    // Capture full-page PNG. document.body.innerText approximates the
    // user-visible text; we use it for the quote-verification post-check.
    const pngBuffer = await page.screenshot({ fullPage: true, type: 'png' });
    const visibleText = await page.evaluate('document.body.innerText || ""');
    const finalUrl = page.url();
    await page.close();

    return {
      pngBuffer: pngBuffer as Buffer,
      visibleText: (visibleText as unknown as string).slice(0, 200_000),
      finalUrl,
      contentSha: createHash('sha256').update(pngBuffer as Buffer).digest('hex'),
    };
  } catch (err) {
    console.error('playwright_snapshot: capture failed', { url, err: String(err) });
    return null;
  } finally {
    try {
      await context.close();
    } catch {}
  }
}

// Called on process shutdown so the browser doesn't leak across the
// worker's daemon lifecycle. Hooked into apps/worker/src/index.ts.
export async function closeSnapshotBrowser(): Promise<void> {
  if (!_browserPromise) return;
  try {
    const b = (await _browserPromise) as { close: () => Promise<void> } | null;
    if (b) await b.close();
  } catch {}
  _browserPromise = null;
}
