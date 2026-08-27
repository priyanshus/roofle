export class AudioChunker {
  private readonly chunkSizeBytes: number;
  private carry = Buffer.alloc(0);

  constructor(chunkSizeBytes: number) {
    if (!Number.isFinite(chunkSizeBytes) || chunkSizeBytes <= 0) {
      throw new Error('chunkSizeBytes must be a positive number');
    }
    this.chunkSizeBytes = chunkSizeBytes;
  }

  push(data: Buffer): Buffer[] {
    if (data.byteLength === 0) return [];

    let merged: Buffer;
    if (this.carry.byteLength === 0) {
      merged = data;
    } else {
      merged = Buffer.concat([this.carry, data]);
      this.carry = Buffer.alloc(0);
    }

    const chunks: Buffer[] = [];
    let offset = 0;

    while (offset + this.chunkSizeBytes <= merged.byteLength) {
      chunks.push(merged.subarray(offset, offset + this.chunkSizeBytes));
      offset += this.chunkSizeBytes;
    }

    if (offset < merged.byteLength) {
      this.carry = Buffer.from(merged.subarray(offset));
    }

    return chunks;
  }

  flushRemainder(): Buffer | null {
    if (this.carry.byteLength === 0) return null;
    const remainder = this.carry;
    this.carry = Buffer.alloc(0);
    return remainder;
  }
}
