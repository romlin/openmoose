/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
/**
 * Persistent Playwright browser daemon.
 * Runs inside a Docker container, exposes an HTTP API for browser control.
 *
 *   GET  /health   → { status: 'ok' }
 *   POST /execute  → { success, url, title, snapshot, preview }
 *
 * Snapshot returns indexed interactive elements so the LLM can refer
 * to them by number (e.g. "click element 3") instead of CSS selectors.
 * Screenshots include visual element labels for debugging.
 */

const http = require('http');
const { chromium } = require('playwright');

const PORT = parseInt(process.env.PORT || '4000', 10);
const SETTLE_TIMEOUT_MS = 3_000;
const SELECTOR_WAIT_TIMEOUT_MS = 5_000;
const SCREENSHOT_PATH = '/app/previews/latest.png';
const ERROR_SCREENSHOT_PATH = '/app/previews/error.png';
const MAX_ELEMENTS = 100;
const MAX_CONTENT_LENGTH = 2_000;
const ELEMENT_ATTR = 'data-eidx';
const LABEL_CLASS = 'moose-label';
const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="checkbox"]',
    '[role="radio"]', '[role="tab"]', '[role="menuitem"]',
    '[contenteditable="true"]',
].join(', ');

let browser, context, page;

/* ── Browser lifecycle ──────────────────────────────────── */

async function ensureBrowser() {
    if (browser?.isConnected() && context && page && !page.isClosed()) return;

    // Clean up after a crash / disconnect
    if (browser && !browser.isConnected()) {
        console.warn('[Daemon] Browser disconnected, relaunching...');
        browser = null; context = null; page = null;
    }

    if (!browser) {
        console.log('[Daemon] Launching browser...');
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        browser.on('disconnected', () => {
            console.warn('[Daemon] Browser process exited unexpectedly');
            browser = null; context = null; page = null;
        });
    }

    if (!context) {
        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 },
            deviceScaleFactor: 1,
        });
    }

    if (!page || page.isClosed()) {
        page = await context.newPage();
    }
}

/* ── Element indexing ───────────────────────────────────── */

/**
 * Find visible interactive elements, inject numbered overlays, and return
 * metadata.  Overlays stay in the DOM for the marked screenshot — call
 * removeLabels() after capturing.
 */
async function labelElements(p) {
    return p.evaluate(({ selector, maxCount, attr, labelClass }) => {
        // Clean previous run
        document.querySelectorAll(`.${labelClass}`).forEach(e => e.remove());
        document.querySelectorAll(`[${attr}]`).forEach(e => e.removeAttribute(attr));

        const isVisible = (el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0
                && r.bottom > 0 && r.top < innerHeight
                && r.right > 0 && r.left < innerWidth
                && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
        };

        return [...document.querySelectorAll(selector)].filter(isVisible).slice(0, maxCount).map((el, i) => {
            el.setAttribute(attr, String(i));

            // Numbered overlay for the marked screenshot
            const lbl = Object.assign(document.createElement('span'), {
                className: labelClass, textContent: String(i),
            });
            const r = el.getBoundingClientRect();
            Object.assign(lbl.style, {
                position: 'fixed',
                top: `${Math.max(0, r.top - 10)}px`,
                left: `${Math.max(0, r.left - 10)}px`,
                background: '#e74c3c', color: '#fff',
                fontSize: '10px', fontWeight: 'bold',
                padding: '1px 4px', borderRadius: '4px',
                zIndex: '2147483647', pointerEvents: 'none',
                lineHeight: '14px', fontFamily: 'monospace',
            });
            document.body.appendChild(lbl);

            const tag = el.tagName.toLowerCase();
            let text = tag === 'select'
                ? (el.options?.[el.selectedIndex]?.text || '')
                : (el.innerText || el.value || el.getAttribute('aria-label')
                    || el.getAttribute('alt') || el.getAttribute('placeholder')
                    || el.getAttribute('title') || '');
            text = text.replace(/\s+/g, ' ').trim().slice(0, 200);

            const info = { index: i, role: el.getAttribute('role') || tag, text };
            if (el.href) info.href = el.href;
            if (el.type) info.type = el.type;
            if (el.checked) info.checked = true;
            if (el.disabled) info.disabled = true;
            return info;
        });
    }, { selector: INTERACTIVE_SELECTOR, maxCount: MAX_ELEMENTS, attr: ELEMENT_ATTR, labelClass: LABEL_CLASS });
}

/** Remove visual overlays but keep data-eidx attributes for the next request. */
async function removeLabels(p) {
    await p.evaluate((cls) => document.querySelectorAll(`.${cls}`).forEach(e => e.remove()), LABEL_CLASS);
}

/** Format element metadata into an LLM-readable indexed list. */
function formatElements(elements) {
    return elements.map(e => {
        let line = `[${e.index}] [${e.role}] "${e.text}"`;
        if (e.href) line += ` → ${e.href}`;
        if (e.type) line += ` (${e.type})`;
        if (e.checked) line += ' [checked]';
        if (e.disabled) line += ' [disabled]';
        return line;
    }).join('\n');
}

/** Extract brief visible text content from the page. */
async function getPageContent(p) {
    try {
        return await p.evaluate(() => {
            const root = document.querySelector('main, [role="main"], article') || document.body;
            return root.innerText.replace(/\s+/g, ' ').trim();
        });
    } catch { return ''; }
}

/* ── Action execution ───────────────────────────────────── */

/** Resolve an element/selector/text reference to a Playwright selector. */
function resolveTarget(raw) {
    if (raw.element != null) return `[${ELEMENT_ATTR}="${raw.element}"]`;
    if (raw.selector) return raw.selector;
    if (raw.text) return `text="${raw.text}"`;
    return null;
}

async function executeAction(p, raw) {
    const type = raw.type || raw.action;
    if (!type) return;

    switch (type) {
        case 'navigate':
            if (!raw.url) break;
            console.log(`[Daemon] Navigating to ${raw.url}`);
            await p.goto(raw.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await p.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
            break;
        case 'click': {
            const target = resolveTarget(raw);
            if (target) await p.click(target);
            break;
        }
        case 'type': {
            const target = resolveTarget(raw);
            if (target && raw.text != null) await p.fill(target, raw.text);
            break;
        }
        case 'press':
            if (raw.key) await p.keyboard.press(raw.key);
            break;
        case 'wait':
            if (raw.selector) await p.waitForSelector(raw.selector, { timeout: SELECTOR_WAIT_TIMEOUT_MS });
            else if (raw.ms) await p.waitForTimeout(raw.ms);
            break;
        case 'screenshot':
            await p.screenshot({ path: SCREENSHOT_PATH });
            break;
    }
}

/* ── HTTP helpers ───────────────────────────────────────── */

const MAX_BODY_SIZE = 1_048_576; // 1 MB

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        let size = 0;
        const onData = (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_SIZE) {
                req.removeListener('data', onData);
                req.removeListener('end', onEnd);
                req.removeListener('error', onError);
                req.destroy();
                reject(new Error('Request body too large'));
                return;
            }
            data += chunk;
        };
        const onEnd = () => resolve(data);
        const onError = (err) => reject(err);
        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
    });
}

function json(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

/* ── Route handler ──────────────────────────────────────── */

async function handleExecute(req, res) {
    try {
        const body = await readBody(req);
        const { actions = [] } = JSON.parse(body);

        await ensureBrowser();
        console.log(`[Daemon] Executing ${actions.length} action(s)`);

        for (const action of actions) {
            try { await executeAction(page, action); }
            catch (err) { console.warn(`[Daemon] Action "${action.type || action.action}" failed: ${err.message}`); }
        }

        // Wait for page to settle before indexing
        await page.waitForLoadState('domcontentloaded').catch(() => {});

        // Index interactive elements and inject visual labels
        let elements = [];
        try { elements = await labelElements(page); }
        catch (e) { console.warn('[Daemon] Element labeling failed:', e.message); }

        // Take marked screenshot (labels visible)
        try { await page.screenshot({ path: SCREENSHOT_PATH }); }
        catch (e) { console.error('[Daemon] Screenshot failed:', e.message); }

        // Remove visual labels from DOM (keep data-eidx for next request)
        await removeLabels(page).catch(() => {});

        const title = await page.title().catch(() => '');
        const content = await getPageContent(page);

        // Build snapshot text
        let snapshot = `Page: ${title}\nURL: ${page.url()}`;
        if (content) snapshot += `\n\n${content.slice(0, MAX_CONTENT_LENGTH)}`;
        if (elements.length > 0) snapshot += `\n\nInteractive elements:\n${formatElements(elements)}`;

        json(res, 200, { success: true, url: page.url(), title, snapshot,
            preview: '.moose/data/browser-previews/latest.png' });
    } catch (err) {
        console.error('[Daemon] Execution error:', err);
        try { if (page) await page.screenshot({ path: ERROR_SCREENSHOT_PATH }); } catch (_) {}
        json(res, 500, { success: false, error: err.message,
            preview: '.moose/data/browser-previews/error.png' });
    }
}

/* ── Server ─────────────────────────────────────────────── */

const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'POST' && req.url === '/execute') return handleExecute(req, res);
    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => console.log(`[Daemon] Listening on port ${PORT}`));

/* ── Graceful shutdown ──────────────────────────────────── */

async function shutdown() {
    console.log('[Daemon] Shutting down...');
    try { if (browser) await browser.close(); } catch (_) {}
    server.close();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
