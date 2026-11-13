import { execFile } from 'node:child_process'
import { cpus, freemem, loadavg, totalmem } from 'node:os'

import type { Machine, Pressure } from './keep.ts'

/**
 * How the machine is doing, for what Browser keeps ready (`keep.ts`). On macOS, the kernel's own
 * memory-pressure level (`kern.memorystatus_vm_pressure_level`: 1 normal, 2 warn, 4 critical), the
 * signal the system itself sheds memory on; elsewhere the share of memory free. Read at most every
 * `EVERY_MS`, without waiting: the last reading is what is said meanwhile.
 */

export const EVERY_MS = 10_000

/** The kernel's level as a pressure. Pure. */
export function pressureOfLevel(level: number): Pressure | null {
  if (level === 1) return 'normal'
  if (level === 2) return 'warn'
  if (level === 4) return 'critical'
  return null
}

/** The share of memory free as a pressure, where the kernel does not say. Pure. */
export function pressureOfFree(free: number, total: number): Pressure {
  const share = total > 0 ? free / total : 1
  return share < 0.05 ? 'critical' : share < 0.15 ? 'warn' : 'normal'
}

export class MachineReading {
  private pressure: Pressure = 'normal'
  private readAt = 0
  private reading = false

  constructor(
    private readonly platform: string = process.platform,
    private readonly onChange: (pressure: Pressure) => void = () => {},
  ) {}

  now(): Machine {
    this.refresh()
    return { totalBytes: totalmem(), pressure: this.pressure, busy: loadavg()[0]! >= Math.max(1, cpus().length) }
  }

  private refresh(): void {
    if (this.reading || Date.now() - this.readAt < EVERY_MS) return
    this.readAt = Date.now()
    const set = (next: Pressure) => {
      const was = this.pressure
      this.pressure = next
      if (next !== was) this.onChange(next)
    }
    if (this.platform !== 'darwin') return set(pressureOfFree(freemem(), totalmem()))
    this.reading = true
    execFile('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 2000 }, (error, out) => {
      this.reading = false
      set((!error && pressureOfLevel(Number(String(out).trim()))) || pressureOfFree(freemem(), totalmem()))
    })
  }
}
