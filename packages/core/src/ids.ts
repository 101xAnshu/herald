import { createHash, randomBytes } from "node:crypto";

const USER_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const bytesToUuid = (bytes: Buffer): string => {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const uuidToBytes = (value: string): Buffer => Buffer.from(value.replaceAll("-", ""), "hex");

export const newId = (): string => {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());

  bytes.writeUIntBE(Number(timestamp & 0xffffffffffffn) % 2 ** 48, 0, 6);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  return bytesToUuid(bytes);
};

export const newTraceId = (): string => newId();

export const userIdFromExternalId = (externalId: string): string => {
  const hash = createHash("sha1")
    .update(uuidToBytes(USER_NAMESPACE))
    .update(Buffer.from(externalId, "utf8"))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  return bytesToUuid(bytes);
};

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

export const traceIdFromHeader = (header: string | undefined): string => {
  if (header && isUuid(header)) {
    return header;
  }

  return newTraceId();
};
