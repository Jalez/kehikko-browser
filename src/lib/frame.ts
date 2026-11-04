/**
 * One screencast frame on the stream socket, as a binary message: eight bytes saying the frame's
 * width and height (two little-endian 32-bit numbers), then the JPEG as Chrome made it.
 *
 * Frames used to go as JSON with the JPEG in base64: a third bigger on the wire, parsed as one long
 * string on the page's main thread, then decoded again from a `data:` address. As bytes, the page
 * hands them to `createImageBitmap`, which decodes off the main thread, and nothing is parsed.
 * Everything else on the socket (page state, console lines, the person's input) stays JSON text.
 */

export const FRAME_HEAD = 8

export interface FrameBytes {
  image: Uint8Array<ArrayBuffer>
  width: number
  height: number
}

/** The server's half: Chrome's base64 JPEG and its size, as one binary message. */
export function frameMessage(frame: { data: string; width: number; height: number }): Uint8Array {
  const jpeg = Buffer.from(frame.data, 'base64')
  const out = new Uint8Array(FRAME_HEAD + jpeg.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, Math.max(0, Math.round(frame.width)) >>> 0, true)
  view.setUint32(4, Math.max(0, Math.round(frame.height)) >>> 0, true)
  out.set(jpeg, FRAME_HEAD)
  return out
}

/** The page's half: a binary message back into its size and the JPEG's bytes, or null when it is too short to be one. */
export function readFrame(message: ArrayBuffer): FrameBytes | null {
  if (message.byteLength < FRAME_HEAD) return null
  const view = new DataView(message)
  return { width: view.getUint32(0, true), height: view.getUint32(4, true), image: new Uint8Array(message, FRAME_HEAD) }
}
