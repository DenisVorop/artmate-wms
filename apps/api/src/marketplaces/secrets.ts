import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { mkdir, open, readFile, lstat, link, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
export class MarketplaceSecrets {
  private pending: Promise<Buffer> | undefined;
  constructor(private readonly options: { key?: string; path?: string } = {}) {}
  private async _key() {
    if (!this.pending)
      this.pending = this._load().catch((e) => {
        this.pending = undefined;
        throw e;
      });
    return this.pending;
  }
  private async _load() {
    const encoded = this.options.key ?? process.env.WMS_MARKETPLACE_KEY;
    if (encoded) {
      const b = Buffer.from(encoded, "base64");
      if (b.length !== 32 || b.toString("base64") !== encoded)
        throw new Error("WMS_MARKETPLACE_KEY must encode 32 bytes");
      return b;
    }
    const path =
      this.options.path ??
      resolve(
        process.env.WMS_MARKETPLACE_KEY_FILE ??
          resolve(__dirname, "../../../..", ".data/marketplace-secret.key"),
      );
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(randomBytes(32));
      await file.sync();
      await file.close();
      // A complete key becomes visible atomically, including across API processes.
      try {
        await link(temporary, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST")
          throw new Error("Не удалось создать ключ шифрования интеграций");
      }
    } finally {
      await file.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
    const info = await lstat(path);
    if (!info.isFile())
      throw new Error("Ключ интеграций должен быть обычным файлом");
    if ((info.mode & 0o077) !== 0)
      throw new Error("Ключ интеграций должен иметь права 0600");
    const value = await readFile(path);
    if (value.length !== 32)
      throw new Error("Некорректный ключ шифрования интеграций");
    return value;
  }
  async encrypt(value: unknown, context: string) {
    const key = await this._key(),
      iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([
      c.update(JSON.stringify(value), "utf8"),
      c.final(),
    ]);
    return [
      "v1",
      iv.toString("base64"),
      c.getAuthTag().toString("base64"),
      ciphertext.toString("base64"),
    ].join(".");
  }
  async decrypt<T>(encoded: string, context: string): Promise<T> {
    try {
      const [v, iv, tag, value] = encoded.split(".");
      if (v !== "v1") throw new Error();
      const d = createDecipheriv(
        "aes-256-gcm",
        await this._key(),
        Buffer.from(iv, "base64"),
      );
      d.setAAD(Buffer.from(context));
      d.setAuthTag(Buffer.from(tag, "base64"));
      return JSON.parse(
        Buffer.concat([
          d.update(Buffer.from(value, "base64")),
          d.final(),
        ]).toString("utf8"),
      );
    } catch {
      throw new Error("Не удалось расшифровать ключ интеграции");
    }
  }
  async fingerprint(value: unknown) {
    return createHmac("sha256", await this._key())
      .update(JSON.stringify(value))
      .digest("hex");
  }
}
