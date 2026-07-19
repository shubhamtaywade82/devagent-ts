import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, Browser, Page } from "playwright";

/**
 * Resolves a Chromium binary to launch without going through Playwright's
 * version-fingerprinted auto-download resolution, which breaks whenever the
 * installed `playwright` package expects a browser revision that wasn't
 * pre-fetched (common in sandboxed/offline environments). If
 * `PLAYWRIGHT_BROWSERS_PATH` points at a directory with a `chromium`
 * executable/symlink directly inside it, use that; otherwise fall back to
 * Playwright's normal resolution unchanged.
 */
export function resolveChromiumExecutablePath(): string | undefined {
  const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (override) return override;
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersPath) return undefined;
  const candidate = join(browsersPath, "chromium");
  return existsSync(candidate) ? candidate : undefined;
}

/** Owns a single lazily-launched headless Chromium instance + one page,
 * reused across tool calls — mirrors LspManager's one-process-per-workspace
 * lifecycle model. The browser process is killed with the parent Node
 * process on exit, same as LSP servers (no explicit teardown wired at the
 * CLI entry point for either). */
export class BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.browser || !this.browser.isConnected()) {
      const executablePath = resolveChromiumExecutablePath();
      this.browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    }
    this.page = await this.browser.newPage();
    return this.page;
  }

  async navigate(url: string): Promise<{ title: string; url: string }> {
    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return { title: await page.title(), url: page.url() };
  }

  async click(selector: string): Promise<void> {
    const page = await this.ensurePage();
    await page.click(selector);
  }

  async fill(selector: string, text: string): Promise<void> {
    const page = await this.ensurePage();
    await page.fill(selector, text);
  }

  async getText(selector?: string): Promise<string> {
    const page = await this.ensurePage();
    if (!selector) return (await page.textContent("body")) ?? "";
    return (await page.textContent(selector)) ?? "";
  }

  async screenshot(): Promise<Buffer> {
    const page = await this.ensurePage();
    return page.screenshot({ type: "png" });
  }

  async evaluate(script: string): Promise<unknown> {
    const page = await this.ensurePage();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return page.evaluate(script);
  }

  get currentUrl(): string | null {
    return this.page && !this.page.isClosed() ? this.page.url() : null;
  }

  async close(): Promise<void> {
    if (this.page && !this.page.isClosed()) await this.page.close().catch(() => {});
    this.page = null;
    if (this.browser && this.browser.isConnected()) await this.browser.close().catch(() => {});
    this.browser = null;
  }
}
