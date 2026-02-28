import { nanoid } from "nanoid";

const SHORT_ID_LENGTH = 8;

export function generateShortId(): string {
  return nanoid(SHORT_ID_LENGTH);
}

export function createIdMapper(): {
  shortToLong: Map<string, string>;
  longToShort: Map<string, string>;
} {
  return {
    shortToLong: new Map(),
    longToShort: new Map(),
  };
}

export function mapId(
  mapper: { shortToLong: Map<string, string>; longToShort: Map<string, string> },
  longId: string
): string {
  const existing = mapper.longToShort.get(longId);
  if (existing) return existing;
  const shortId = generateShortId();
  mapper.shortToLong.set(shortId, longId);
  mapper.longToShort.set(longId, shortId);
  return shortId;
}
