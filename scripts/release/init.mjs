import * as fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  args,
  required,
  domainName,
  protectedFile,
  exclusiveWrite,
  main,
  isMain,
} from "./lib.mjs";

export async function initialize(options) {
  const filename = path.resolve(required(options, "--env-file"));
  const domain = required(options, "--domain");
  if (!domainName.test(domain))
    throw new Error("Use a lowercase DNS hostname without scheme or path.");
  if (
    Boolean(options["--new-install"]) ===
    Boolean(options["--existing-key-file"])
  )
    throw new Error(
      "Choose exactly one: --new-install or --existing-key-file. Import the original key when transferring existing data.",
    );
  let key;
  if (options["--existing-key-file"]) {
    await protectedFile(options["--existing-key-file"]);
    key = await fs.readFile(options["--existing-key-file"]);
    if (key.length !== 32)
      throw new Error(
        "Existing key file must contain exactly 32 raw bytes. Do not replace the key of an existing database.",
      );
  } else key = randomBytes(32);
  const password = randomBytes(32).toString("hex");
  const body = [
    "# Private production configuration. Never commit or share this file.",
    "# Replace both image placeholders with published sha tags or digests.",
    "# Preserve WMS_MARKETPLACE_KEY with every database transfer; it decrypts integrations.",
    `WMS_DOMAIN=${domain}`,
    "WMS_API_IMAGE=ghcr.io/OWNER/artmate-wms-api:sha-REPLACE",
    "WMS_WEB_IMAGE=ghcr.io/OWNER/artmate-wms-web:sha-REPLACE",
    "POSTGRES_USER=wms",
    "POSTGRES_DB=artmate_wms",
    `POSTGRES_PASSWORD=${password}`,
    `WMS_MARKETPLACE_KEY=${key.toString("base64")}`,
    "",
  ].join("\n");
  await exclusiveWrite(filename, body);
}

if (isMain(import.meta.url))
  main(async () => {
    const options = args(process.argv.slice(2), [
      "--env-file",
      "--domain",
      "--new-install",
      "--existing-key-file",
    ]);
    await initialize(options);
    console.log(
      "Protected environment created. Set immutable image references before preflight. Keep the encryption key with the database.",
    );
  });
