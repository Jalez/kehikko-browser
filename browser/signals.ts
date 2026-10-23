/**
 * Playwright's own SIGINT/SIGTERM/SIGHUP handlers, off, for every browser this module launches.
 * This process stops its browsers itself, by closing them, and waits for that (browser/index.ts).
 * Playwright's handlers race that close and win: the process then exits with Chrome half-way
 * through writing its cookies (measured: a cookie set 100 ms before a stop was lost). Its `exit`
 * handler, which kills a browser still running when the process goes, stays.
 */
export const NO_SIGNAL_HANDLERS = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false } as const
