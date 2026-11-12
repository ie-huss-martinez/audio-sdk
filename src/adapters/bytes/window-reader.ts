/** How much a window reads at a time: large enough that walking a file costs few `Blob` reads. */
const WINDOW = 1 << 20;

/**
 * Reads a `Blob` through a window of up to 1 MiB, so that readers which walk
 * a file in small steps, such as Ogg pages or FLAC frame headers, read it in
 * large slices and never load all of it (docs/adr/0001).
 *
 * @internal
 */
export class WindowReader {
  readonly size: number;
  #file: Blob;
  #start = 0;
  #bytes = new Uint8Array(0);

  constructor(file: Blob) {
    this.#file = file;
    this.size = file.size;
  }

  /**
   * Up to `length` bytes at `offset`, fewer at the end of the file. The
   * result is a view into the window, valid until the next call.
   */
  async bytes(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(this.size, offset + length);
    if (offset < this.#start || end > this.#start + this.#bytes.length) {
      const windowEnd = Math.min(this.size, offset + Math.max(length, WINDOW));
      this.#bytes = new Uint8Array(await this.#file.slice(offset, windowEnd).arrayBuffer());
      this.#start = offset;
    }
    return this.#bytes.subarray(offset - this.#start, end - this.#start);
  }
}
