import { describe, expect, test } from 'bun:test'

import { buttonName, fitFrame, keyEventParams, modifierBits, toViewport, viewportFor } from '../src/lib/input.ts'

describe('pointer coordinates', () => {
  test('a frame the size of the canvas fills it, and a point maps one to one', () => {
    const drawn = fitFrame({ width: 800, height: 600 }, { width: 800, height: 600 })
    expect(drawn).toEqual({ left: 0, top: 0, width: 800, height: 600 })
    expect(toViewport({ x: 100, y: 50 }, drawn, { width: 800, height: 600 })).toEqual({ x: 100, y: 50 })
  })

  test('a stale frame is letterboxed, and a point maps through the frame actually drawn', () => {
    /* The canvas grew to 1000×600 but the browser still sends 800×600 frames. */
    const drawn = fitFrame({ width: 800, height: 600 }, { width: 1000, height: 600 })
    expect(drawn).toEqual({ left: 100, top: 0, width: 800, height: 600 })
    expect(toViewport({ x: 500, y: 300 }, drawn, { width: 800, height: 600 })).toEqual({ x: 400, y: 300 })
    expect(toViewport({ x: 50, y: 300 }, drawn, { width: 800, height: 600 })).toBeNull()
  })

  test('a frame scaled down maps back up to viewport pixels', () => {
    const drawn = fitFrame({ width: 1600, height: 1200 }, { width: 800, height: 600 })
    expect(toViewport({ x: 400, y: 300 }, drawn, { width: 1600, height: 1200 })).toEqual({ x: 800, y: 600 })
    expect(toViewport({ x: 800, y: 600 }, drawn, { width: 1600, height: 1200 })).toEqual({ x: 1599, y: 1199 })
  })

  test('the viewport asked for is whole pixels inside sane bounds', () => {
    expect(viewportFor({ width: 640.6, height: 480.2 })).toEqual({ width: 641, height: 480 })
    expect(viewportFor({ width: 10, height: 10 })).toEqual({ width: 200, height: 150 })
    expect(viewportFor({ width: 99999, height: 99999 })).toEqual({ width: 3840, height: 2160 })
  })
})

describe('keys and buttons', () => {
  test('modifiers are CDP’s bitmask', () => {
    expect(modifierBits({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(1)
    expect(modifierBits({ altKey: false, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(14)
  })

  test('buttons are named as CDP names them', () => {
    expect([0, 1, 2, 3].map(buttonName)).toEqual(['left', 'middle', 'right', 'none'])
  })

  test('a printable key types its character; Enter types a return', () => {
    expect(keyEventParams({ type: 'down', key: 'a', code: 'KeyA', keyCode: 65, modifiers: 0 })).toMatchObject({ type: 'keyDown', text: 'a' })
    expect(keyEventParams({ type: 'down', key: 'Enter', code: 'Enter', keyCode: 13, modifiers: 0 })).toMatchObject({ type: 'keyDown', text: '\r' })
    expect(keyEventParams({ type: 'up', key: 'a', code: 'KeyA', keyCode: 65, modifiers: 0 })).toMatchObject({ type: 'keyUp' })
  })

  test('a key that types nothing is a raw key down', () => {
    const params = keyEventParams({ type: 'down', key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, modifiers: 0 })
    expect(params).toMatchObject({ type: 'rawKeyDown', windowsVirtualKeyCode: 37 })
    expect(params?.text).toBeUndefined()
  })

  test('a chord types nothing, and Meta+A/C/X/Z carry the editing command', () => {
    expect(keyEventParams({ type: 'down', key: 'a', code: 'KeyA', keyCode: 65, modifiers: 4 })).toMatchObject({ type: 'rawKeyDown', commands: ['selectAll'] })
    expect(keyEventParams({ type: 'down', key: 'z', code: 'KeyZ', keyCode: 90, modifiers: 4 | 8 })).toMatchObject({ commands: ['redo'] })
    expect(keyEventParams({ type: 'down', key: 'a', code: 'KeyA', keyCode: 65, modifiers: 2 })?.text).toBeUndefined()
  })

  test('nonsense is not sent', () => {
    expect(keyEventParams({ type: 'down', key: '', code: '', keyCode: 0, modifiers: 0 })).toBeNull()
    expect(keyEventParams({ type: 'down', key: 'x'.repeat(40), code: '', keyCode: 0, modifiers: 0 })).toBeNull()
  })
})
