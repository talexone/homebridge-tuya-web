/**
 * Cryptographic helper functions for SmartLife API
 */

import {
  createHash,
  createHmac,
  createPublicKey,
  publicEncrypt,
  constants as cryptoConstants,
} from "crypto";

/**
 * Generate a mobile hash (special MD5 variant)
 * Used for hashing postData in request signatures
 */
export function mobileHash(value: string): string {
  const md5 = createHash("md5").update(value).digest("hex");
  return (
    md5.slice(8, 16) +
    md5.slice(0, 8) +
    md5.slice(24, 32) +
    md5.slice(16, 24)
  );
}

/**
 * Convert a decimal integer string to a Buffer
 * Used for RSA public key construction
 */
function bigIntDecimalToBuffer(decimal: string): Buffer {
  const sanitized = decimal.trim();
  if (!/^[0-9]+$/.test(sanitized)) {
    throw new Error("Invalid decimal integer");
  }

  let hex = BigInt(sanitized).toString(16);
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }

  const bytes = Buffer.from(hex, "hex");
  if (bytes.length === 0) {
    return Buffer.from([0]);
  }

  return bytes;
}

/**
 * Convert a Buffer to base64url encoding
 */
function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Encrypt password using RSA public key with exponent
 * This is the primary encryption method
 */
export function encryptPasswordWithPublicKeyExponent(
  passwordMd5Hex: string,
  modulusDecimal: string,
  exponentDecimal: string,
): string {
  const key = createPublicKey({
    key: {
      kty: "RSA",
      n: toBase64Url(bigIntDecimalToBuffer(modulusDecimal)),
      e: toBase64Url(bigIntDecimalToBuffer(exponentDecimal)),
    },
    format: "jwk",
  });

  return publicEncrypt(
    {
      key,
      padding: cryptoConstants.RSA_PKCS1_PADDING,
    },
    Buffer.from(passwordMd5Hex, "utf8"),
  ).toString("hex");
}

/**
 * Encrypt password using RSA public key (DER format)
 * This is the fallback encryption method
 */
export function encryptPasswordWithPbKey(
  passwordMd5Hex: string,
  pbKeyBase64: string,
): string {
  const key = createPublicKey({
    key: Buffer.from(pbKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });

  return publicEncrypt(
    {
      key,
      padding: cryptoConstants.RSA_PKCS1_PADDING,
    },
    Buffer.from(passwordMd5Hex, "utf8"),
  ).toString("hex");
}

/**
 * Create HMAC SHA256 signature
 */
export function createHmacSignature(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/**
 * Generate MD5 hash
 */
export function md5Hash(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

/**
 * Generate a random device ID
 */
export function randomDeviceId(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * alphabet.length);
    result += alphabet[index];
  }
  return result;
}
