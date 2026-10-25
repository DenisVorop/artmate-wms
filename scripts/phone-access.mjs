import { networkInterfaces } from "node:os";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  renameSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { X509Certificate, createHash } from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
export const phoneDirectory = path.join(root, ".data/phone-access");
export const tlsPort = 3443;
export const setupPort = 3442;
export function isPrivateIPv4(address) {
  const parts = address.split(".");
  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !/^\d{1,3}$/.test(part) ||
        Number(part) > 255 ||
        String(Number(part)) !== part,
    )
  )
    return false;
  const [a, b] = parts.map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}
export function lanAddresses(interfaces = networkInterfaces()) {
  return [
    ...new Set(
      Object.entries(interfaces)
        .filter(
          ([name]) =>
            !/^(?:utun|tun|tap|awdl|llw|gif|stf|tailscale|wg|docker|veth|bridge|br-|vmnet|vboxnet|virbr)/i.test(
              name,
            ),
        )
        .flatMap(([, entries]) =>
          (entries ?? [])
            .filter(
              (entry) =>
                entry.family === "IPv4" &&
                !entry.internal &&
                isPrivateIPv4(entry.address),
            )
            .map((entry) => entry.address),
        ),
    ),
  ].sort();
}
function openssl(args) {
  const result = spawnSync("openssl", args, { encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw new Error(
      `Не удалось подготовить сертификат OpenSSL: ${result.error?.message ?? result.stderr.trim()}`,
    );
  return result.stdout;
}
function privateFile(directory, name, content) {
  const file = path.join(directory, name);
  writeFileSync(`${file}.tmp`, content, { mode: 0o600 });
  chmodSync(`${file}.tmp`, 0o600);
  renameSync(`${file}.tmp`, file);
}
export function preparePhoneAccess({
  directory = phoneDirectory,
  interfaces,
} = {}) {
  const addresses = lanAddresses(interfaces);
  if (!addresses.length)
    throw new Error(
      "Не найден IPv4-адрес локальной сети. Подключите компьютер к складскому Wi-Fi или Ethernet.",
    );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const file = (name) => path.join(directory, name);
  if (!existsSync(file("ca.key")) && !existsSync(file("ca.pem"))) {
    openssl([
      "req",
      "-x509",
      "-newkey",
      "rsa:3072",
      "-sha256",
      "-nodes",
      "-days",
      "3650",
      "-keyout",
      file("ca.key"),
      "-out",
      file("ca.pem"),
      "-subj",
      "/CN=Artmate WMS Local CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
    ]);
    chmodSync(file("ca.key"), 0o600);
  }
  if (!existsSync(file("ca.key")) || !existsSync(file("ca.pem")))
    throw new Error(
      "Неполный комплект локальной CA. Восстановите каталог .data/phone-access из защищённой копии; существующая CA автоматически не заменяется.",
    );
  openssl(["x509", "-in", file("ca.pem"), "-checkend", "86400", "-noout"]);
  const previous = readPhoneConfig(directory);
  const certificateCurrent =
    existsSync(file("server.pem")) &&
    existsSync(file("server.key")) &&
    spawnSync("openssl", [
      "x509",
      "-in",
      file("server.pem"),
      "-checkend",
      "2592000",
      "-noout",
    ]).status === 0;
  if (
    !certificateCurrent ||
    JSON.stringify(previous?.addresses) !== JSON.stringify(addresses)
  ) {
    privateFile(
      directory,
      "server.ext",
      `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${addresses.map((address) => `IP:${address}`).join(",")}\n`,
    );
    openssl([
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      file("server.key"),
      "-out",
      file("server.csr"),
      "-subj",
      "/CN=Artmate WMS Warehouse",
    ]);
    chmodSync(file("server.key"), 0o600);
    openssl([
      "x509",
      "-req",
      "-sha256",
      "-days",
      "365",
      "-in",
      file("server.csr"),
      "-CA",
      file("ca.pem"),
      "-CAkey",
      file("ca.key"),
      "-CAcreateserial",
      "-extfile",
      file("server.ext"),
      "-out",
      file("server.pem"),
    ]);
  }
  openssl([
    "x509",
    "-in",
    file("ca.pem"),
    "-outform",
    "DER",
    "-out",
    file("ca.cer"),
  ]);
  const config = { version: 1, addresses, tlsPort, setupPort };
  privateFile(directory, "config.json", `${JSON.stringify(config, null, 2)}\n`);
  return config;
}
export function readPhoneConfig(directory = phoneDirectory) {
  try {
    const config = JSON.parse(
      readFileSync(path.join(directory, "config.json"), "utf8"),
    );
    if (
      config.version !== 1 ||
      config.tlsPort !== tlsPort ||
      config.setupPort !== setupPort ||
      !Array.isArray(config.addresses) ||
      !config.addresses.length ||
      config.addresses.some((ip) => !isPrivateIPv4(ip))
    )
      return null;
    return config;
  } catch {
    return null;
  }
}
export function phoneOrigins(config) {
  return config.addresses.map((address) => `https://${address}:${tlsPort}`);
}
export function allowedPhoneRequest(request, addresses, port) {
  const remote = request.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "";
  return (
    isPrivateIPv4(remote) &&
    addresses.some(
      (address) => request.headers.host === `${address}:${port}`,
    ) &&
    typeof request.url === "string" &&
    request.url.startsWith("/") &&
    !request.url.startsWith("//") &&
    !request.url.includes("\\")
  );
}
export function secureCookies(value) {
  if (!value) return value;
  return (Array.isArray(value) ? value : [value]).map((cookie) =>
    /;\s*secure\s*(?:;|$)/i.test(cookie) ? cookie : `${cookie}; Secure`,
  );
}
const hopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
export function proxyHeaders(headers, host) {
  const connectionHeaders = String(headers.connection ?? "")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim());
  return Object.fromEntries(
    Object.entries(headers)
      .filter(
        ([name]) =>
          !hopHeaders.has(name) &&
          !connectionHeaders.includes(name) &&
          !name.startsWith("x-forwarded-") &&
          !name.startsWith("proxy-") &&
          name !== "forwarded" &&
          name !== "x-real-ip" &&
          name !== "host",
      )
      .concat([["host", host]]),
  );
}
function setupHtml(config, fingerprint) {
  const origins = phoneOrigins(config);
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Artmate WMS · телефон</title><style>body{font:17px/1.6 system-ui;background:#111918;color:#eef9f6;max-width:680px;padding:28px;margin:auto}a{color:#78eac5}li{margin:18px 0}code{overflow-wrap:anywhere}small{color:#a3bbb3}</style><h1>Подключить телефон к WMS</h1><p>Телефон и компьютер должны быть в одной складской сети. Компьютер с WMS должен оставаться включённым.</p><ol><li><a href="/ca.cer" download="Artmate-WMS-CA.cer">Скачать сертификат склада</a>. Это корневой сертификат локальной WMS; его закрытый ключ хранится на компьютере склада. Сверьте отпечаток SHA-256 с выводом команды на этом компьютере. Устанавливайте сертификат только из доверенного источника.<p><small>SHA-256: <code>${fingerprint}</code></small></p></li><li><b>iPhone:</b> откройте скачанный профиль в настройках, установите его. Затем: Настройки → Основные → Об этом устройстве → Доверие сертификатам → включите доверие «Artmate WMS Local CA».<br><b>Android:</b> в настройках найдите «Установить сертификат CA» и выберите скачанный файл. Названия пунктов зависят от телефона; для установки может потребоваться PIN.</li><li>Откройте рабочий экран: ${origins.map((origin) => `<p><a href="${origin}/work">${origin}/work</a></p>`).join("")} Если браузер сообщает об ошибке сертификата, проверьте установку CA и дату телефона; не вводите пароль через страницу с предупреждением.</li><li>Добавьте рабочий экран на главный экран телефона через меню браузера и войдите под своим сотрудником.</li></ol><small>При смене IP компьютера запустите <code>yarn phone:setup</code> и перезапустите WMS. Лучше закрепить IP компьютера в настройках роутера. Доступ через интернет не включается.</small></html>`;
}
export function setupHandler(
  config,
  certificate = readFileSync(path.join(phoneDirectory, "ca.cer")),
) {
  const fingerprint = createHash("sha256")
    .update(certificate)
    .digest("hex")
    .toUpperCase()
    .match(/.{2}/g)
    .join(":");
  const html = setupHtml(config, fingerprint);
  return (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (!allowedPhoneRequest(request, config.addresses, setupPort)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    if (request.url === "/ca.cer") {
      response.writeHead(200, {
        "Content-Type": "application/pkix-cert",
        "Content-Disposition": 'attachment; filename="Artmate-WMS-CA.cer"',
      });
      response.end(request.method === "HEAD" ? undefined : certificate);
    } else if (request.url === "/" || request.url === "/phone-setup") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : html);
    } else {
      response.writeHead(404);
      response.end();
    }
  };
}
export function gatewayHandler(config, ports = { api: 4080, web: 3080 }) {
  if (
    ![ports.api, ports.web].every(
      (port) =>
        Number.isInteger(port) &&
        port > 0 &&
        port < 65536 &&
        port !== tlsPort &&
        port !== setupPort,
    )
  )
    throw new Error("Некорректные внутренние порты WMS");
  return (request, response) => {
    if (!allowedPhoneRequest(request, config.addresses, tlsPort)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const api = request.url === "/api" || request.url.startsWith("/api/");
    const port = api ? ports.api : ports.web;
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: request.url,
        method: request.method,
        headers: proxyHeaders(request.headers, `127.0.0.1:${port}`),
        timeout:
          request.method === "POST" &&
          /^\/api\/marketplaces\/sync(?:\?|$)/.test(request.url)
            ? 270000
            : 30000,
      },
      (reply) => {
        const headers = { ...reply.headers };
        for (const name of hopHeaders) delete headers[name];
        if (headers["set-cookie"])
          headers["set-cookie"] = secureCookies(headers["set-cookie"]);
        response.writeHead(reply.statusCode ?? 502, headers);
        reply.pipe(response);
      },
    );
    upstream.on("timeout", () =>
      upstream.destroy(new Error("Upstream timeout")),
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end(
        "WMS временно недоступна. Проверьте, что приложение запущено на компьютере склада.",
      );
    });
    request.on("aborted", () => upstream.destroy());
    request.on("error", () => upstream.destroy());
    response.on("error", () => upstream.destroy());
    response.on("close", () => {
      if (!response.writableFinished) upstream.destroy();
    });
    request.pipe(upstream);
  };
}
export async function startPhoneAccess(config) {
  const servers = [];
  const file = (name) => readFileSync(path.join(phoneDirectory, name));
  try {
    for (const address of config.addresses) {
      const gateway = https.createServer(
        {
          key: file("server.key"),
          cert: file("server.pem"),
          minVersion: "TLSv1.2",
        },
        gatewayHandler(config),
      );
      gateway.on("upgrade", (_request, socket) => socket.destroy());
      const setup = http.createServer(setupHandler(config));
      for (const [server, port] of [
        [gateway, tlsPort],
        [setup, setupPort],
      ]) {
        servers.push(server);
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(port, address, resolve);
        });
      }
    }
  } catch (error) {
    for (const server of servers) server.closeAllConnections?.();
    for (const server of servers) server.close();
    throw error;
  }
  return {
    close() {
      for (const server of servers) {
        server.closeAllConnections?.();
        server.close();
      }
    },
  };
}
export function printPhoneAddresses(config) {
  const certificate = new X509Certificate(
    readFileSync(path.join(phoneDirectory, "ca.pem")),
  );
  console.log(
    `Сертификат Artmate WMS Local CA · SHA-256: ${certificate.fingerprint256}`,
  );
  for (const address of config.addresses)
    console.log(
      `Телефон: https://${address}:${tlsPort}/work | первое подключение: http://${address}:${setupPort}`,
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv[2] !== "setup")
      throw new Error("Использование: yarn phone:setup, затем yarn start");
    const config = preparePhoneAccess();
    console.log(
      "Сертификаты готовы. Они не установлены в доверенные на этом компьютере. Перезапустите WMS: yarn start.",
    );
    printPhoneAddresses(config);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
