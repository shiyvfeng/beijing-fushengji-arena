import { stableStringify } from "../stable-value.js";

export const RNG_VERSION = "arena-rng-v1" as const;

export type RandomCoordinate = string | number | boolean;

const MASK_64 = 0xffffffffffffffffn;

function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < input.length; index++) {
    const codePoint = input.codePointAt(index)!;
    hash ^= BigInt(codePoint);
    hash = (hash * prime) & MASK_64;
    if (codePoint > 0xffff) index++;
  }
  return hash;
}

function splitMix64(value: bigint): bigint {
  let mixed = (value + 0x9e3779b97f4a7c15n) & MASK_64;
  mixed = ((mixed ^ (mixed >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  mixed = ((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return (mixed ^ (mixed >> 31n)) & MASK_64;
}

/**
 * A versioned, coordinate-addressed RNG. `at()` is independent of call order,
 * so observations, presentation reads and invalid actions cannot consume game entropy.
 */
export class SeededRng {
  readonly version = RNG_VERSION;
  private readonly seedMaterial: string;

  constructor(seed: number | string, namespace = "arena") {
    this.seedMaterial = stableStringify({ version: RNG_VERSION, namespace, seed });
  }

  uint32(streamName: string, ...coordinates: readonly RandomCoordinate[]): number {
    const input = stableStringify({
      seed: this.seedMaterial,
      stream: streamName,
      coordinates,
    });
    const mixed = splitMix64(fnv1a64(input));
    return Number(mixed & 0xffffffffn) >>> 0;
  }

  float(streamName: string, ...coordinates: readonly RandomCoordinate[]): number {
    return this.uint32(streamName, ...coordinates) / 0x1_0000_0000;
  }

  int(
    streamName: string,
    maxExclusive: number,
    ...coordinates: readonly RandomCoordinate[]
  ): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError("maxExclusive must be a positive safe integer");
    }
    return Math.floor(this.float(streamName, ...coordinates) * maxExclusive);
  }

  stream(streamName: string): NamedRandomStream {
    return new NamedRandomStream(this, streamName);
  }
}

/** Stateful convenience wrapper. Core rules prefer coordinate-addressed calls. */
export class NamedRandomStream {
  private cursor = 0;

  constructor(
    private readonly rng: SeededRng,
    readonly name: string,
  ) {}

  get position(): number {
    return this.cursor;
  }

  nextUint32(): number {
    const value = this.rng.uint32(this.name, this.cursor);
    this.cursor++;
    return value;
  }

  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError("maxExclusive must be a positive safe integer");
    }
    return Math.floor(this.nextFloat() * maxExclusive);
  }
}
