/**
 * How a Playwright test, or Playwright MCP, attaches to the browser the person
 * is watching. One spelling, for the page's info view and the `cdp_endpoint` tool.
 */

export interface Snippets {
  test: string
  mcp: string
  claude: string
}

export function snippets(http: string): Snippets {
  return {
    test: [
      "import { chromium } from 'playwright'",
      '',
      `const browser = await chromium.connectOverCDP('${http}')`,
      'const context = browser.contexts()[0]',
      'const page = context.pages().at(-1) // the page shown in Kehikot',
      'console.log(await page.title())',
      '// browser.close() here only disconnects; the browser keeps running',
    ].join('\n'),
    mcp: `npx @playwright/mcp@latest --cdp-endpoint ${http}`,
    claude: `claude mcp add playwright -- npx @playwright/mcp@latest --cdp-endpoint ${http}`,
  }
}
