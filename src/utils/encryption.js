import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey() {
  const key = process.env.SETTINGS_ENCRYPTION_KEY;

  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be a 64-character hexadecimal key.");
  }

  return Buffer.from(key, "hex");
}

export function encrypt(value) {
  if (!value) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  const authTag = cipher.getAuthTag();

  return ["v1", iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decrypt(value) {
  if (!value) return "";

  const [version, ivHex, tagHex, encryptedHex] = value.split(":");

  if (version !== "v1" || !ivHex || !tagHex || !encryptedHex) {
    throw new Error("Invalid encrypted settings value.");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivHex, "hex"),
  );

  decipher.setAuthTag(Buffer.from(tagHex, "hex"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
