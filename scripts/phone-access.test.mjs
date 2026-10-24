import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPrivateIPv4,
  lanAddresses,
  allowedPhoneRequest,
  secureCookies,
  proxyHeaders,
  setupHandler,
  phoneOrigins,
  tlsPort,
  setupPort,
} from "./phone-access.mjs";
const config = { version: 1, addresses: ["192.168.1.25"], tlsPort, setupPort };
const request = (
  url = "/work",
  host = `192.168.1.25:${tlsPort}`,
  remoteAddress = "192.168.1.80",
) => ({ url, headers: { host }, socket: { remoteAddress }, method: "GET" });
test("only RFC1918 IPv4 NICs enter the exact phone origin allowlist", () => {
  for (const ip of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.0.1"])
    assert.equal(isPrivateIPv4(ip), true, ip);
  for (const ip of [
    "127.0.0.1",
    "0.0.0.0",
    "8.8.8.8",
    "169.254.2.3",
    "172.32.0.1",
    "192.169.1.2",
    "192.168.1.256",
    "192.168.01.1",
    "::1",
  ])
    assert.equal(isPrivateIPv4(ip), false, ip);
  assert.deepEqual(
    lanAddresses({
      lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
      en0: [
        { family: "IPv4", internal: false, address: "192.168.1.25" },
        { family: "IPv4", internal: false, address: "192.168.1.25" },
        { family: "IPv6", internal: false, address: "fd01::1" },
      ],
      wan: [{ family: "IPv4", internal: false, address: "1.2.3.4" }],
    }),
    ["192.168.1.25"],
  );
  assert.deepEqual(phoneOrigins(config), ["https://192.168.1.25:3443"]);
});
test("known VPN and virtual adapters never become employee LAN links", () => {
  const nic = (address) => [{ family: "IPv4", internal: false, address }];
  const virtualNames = [
    "utun8",
    "tun0",
    "tap0",
    "awdl0",
    "llw0",
    "gif0",
    "stf0",
    "tailscale0",
    "wg0",
    "docker0",
    "vethabc",
    "bridge100",
    "br-abc",
    "vmnet1",
    "vboxnet0",
    "virbr0",
  ];
  const interfaces = Object.fromEntries(
    virtualNames.map((name) => [name, nic("10.212.134.11")]),
  );
  interfaces.en0 = nic("192.168.1.72");
  assert.deepEqual(lanAddresses(interfaces), ["192.168.1.72"]);
  assert.deepEqual(lanAddresses({ fixture: nic("192.168.1.25") }), [
    "192.168.1.25",
  ]);
});
test("gateway rejects DNS rebinding, public clients and absolute-form targets", () => {
  assert.equal(allowedPhoneRequest(request(), config.addresses, tlsPort), true);
  assert.equal(
    allowedPhoneRequest(
      request("/", "evil.example:3443"),
      config.addresses,
      tlsPort,
    ),
    false,
  );
  assert.equal(
    allowedPhoneRequest(
      request("/", "192.168.1.25:3080"),
      config.addresses,
      tlsPort,
    ),
    false,
  );
  assert.equal(
    allowedPhoneRequest(
      request("/", undefined, "8.8.8.8"),
      config.addresses,
      tlsPort,
    ),
    false,
  );
  for (const url of ["http://127.0.0.1:5440", "//evil.example/api", "/\\evil"])
    assert.equal(
      allowedPhoneRequest(request(url), config.addresses, tlsPort),
      false,
    );
  assert.equal(
    allowedPhoneRequest(
      request("/api/auth/session", undefined, "::ffff:192.168.1.80"),
      config.addresses,
      tlsPort,
    ),
    true,
  );
});
test("forwarding spoof cannot change HTTPS cookie boundary", () => {
  const headers = proxyHeaders(
    {
      host: "192.168.1.25:3443",
      forwarded: "proto=http",
      "x-forwarded-proto": "http",
      "x-forwarded-host": "evil",
      "x-real-ip": "8.8.8.8",
      connection: "x-secret",
      "x-secret": "hidden",
      "proxy-authorization": "secret",
      cookie: "wms_session=opaque",
      origin: "https://192.168.1.25:3443",
      "x-wms-csrf": "csrf",
    },
    "127.0.0.1:4080",
  );
  assert.deepEqual(headers, {
    host: "127.0.0.1:4080",
    cookie: "wms_session=opaque",
    origin: "https://192.168.1.25:3443",
    "x-wms-csrf": "csrf",
  });
  assert.deepEqual(
    secureCookies([
      "wms_session=opaque; HttpOnly; SameSite=Strict",
      "wms_session=; Max-Age=0; Secure",
    ]),
    [
      "wms_session=opaque; HttpOnly; SameSite=Strict; Secure",
      "wms_session=; Max-Age=0; Secure",
    ],
  );
});
function invoke(url, method = "GET", host = `192.168.1.25:${setupPort}`) {
  const req = { ...request(url, host), method };
  const response = {
    status: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(body) {
      this.body = body;
    },
  };
  setupHandler(config, Buffer.from("public-cert"))(req, response);
  return response;
}
test("enrollment HTTP serves only public certificate and fixed instructions", () => {
  assert.equal(invoke("/").status, 200);
  assert.match(invoke("/").body, /https:\/\/192\.168\.1\.25:3443\/work/);
  assert.equal(invoke("/ca.cer").body.toString(), "public-cert");
  assert.equal(invoke("/ca.cer", "HEAD").body, undefined);
  for (const url of [
    "/api/auth/login",
    "/api/auth/session",
    "/work",
    "/ca.key",
    "/server.key",
    "/../ca.key",
    "/%2e%2e/ca.key",
    "/ca.cer?file=ca.key",
  ])
    assert.equal(invoke(url).status, 404, url);
  assert.equal(invoke("/ca.cer", "POST").status, 405);
  assert.equal(invoke("/", "GET", "evil.example:3442").status, 403);
  assert.match(
    invoke("/").headers["Content-Security-Policy"],
    /default-src 'none'/,
  );
});

test("local CA is idempotent, SAN changes renew leaf only, private keys stay private", async () => {
  const { mkdtempSync, readFileSync, statSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { X509Certificate } = await import("node:crypto");
  const { preparePhoneAccess } = await import("./phone-access.mjs");
  const directory = mkdtempSync(`${tmpdir()}/wms-phone-cert-`);
  const interfaces = (ip) => ({
    fixture: [{ family: "IPv4", internal: false, address: ip }],
  });
  try {
    preparePhoneAccess({ directory, interfaces: interfaces("192.168.1.25") });
    const ca = new X509Certificate(readFileSync(`${directory}/ca.pem`));
    const leaf = new X509Certificate(readFileSync(`${directory}/server.pem`));
    assert.equal(ca.ca, true);
    assert.equal(leaf.ca, false);
    assert.equal(leaf.verify(ca.publicKey), true);
    assert.equal(leaf.checkIP("192.168.1.25"), "192.168.1.25");
    assert.equal(leaf.checkIP("127.0.0.1"), undefined);
    assert.ok(
      (Date.parse(leaf.validTo) - Date.parse(leaf.validFrom)) / 86400000 <= 365,
    );
    for (const name of ["ca.key", "server.key"])
      assert.equal(statSync(`${directory}/${name}`).mode & 0o777, 0o600);
    preparePhoneAccess({ directory, interfaces: interfaces("192.168.1.25") });
    assert.equal(
      new X509Certificate(readFileSync(`${directory}/server.pem`))
        .fingerprint256,
      leaf.fingerprint256,
    );
    preparePhoneAccess({ directory, interfaces: interfaces("192.168.1.26") });
    assert.equal(
      new X509Certificate(readFileSync(`${directory}/ca.pem`)).fingerprint256,
      ca.fingerprint256,
    );
    const renewed = new X509Certificate(
      readFileSync(`${directory}/server.pem`),
    );
    assert.equal(renewed.checkIP("192.168.1.26"), "192.168.1.26");
    assert.equal(renewed.verify(ca.publicKey), true);
    assert.equal(
      new X509Certificate(readFileSync(`${directory}/ca.cer`)).fingerprint256,
      ca.fingerprint256,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("real TLS gateway routes API and web, preserves CSRF origin, enforces Secure, handles unavailable backend", async () => {
  const http = await import("node:http");
  const https = await import("node:https");
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { checkServerIdentity } = await import("node:tls");
  const { preparePhoneAccess, gatewayHandler } =
    await import("./phone-access.mjs");
  const directory = mkdtempSync(`${tmpdir()}/wms-phone-proxy-`);
  const servers = [];
  const listen = async (server) => {
    servers.push(server);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    return server.address().port;
  };
  const close = async (server) => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  try {
    preparePhoneAccess({
      directory,
      interfaces: {
        fixture: [{ family: "IPv4", internal: false, address: "192.168.1.25" }],
      },
    });
    let observed;
    const api = http.createServer((request, response) => {
      observed = request.headers;
      response.setHeader("Set-Cookie", [
        "wms_session=opaque; HttpOnly; SameSite=Strict",
      ]);
      response.end("api fixture");
    });
    const web = http.createServer((_request, response) =>
      response.end("web fixture"),
    );
    const ports = { api: await listen(api), web: await listen(web) };
    const handler = gatewayHandler(config, ports);
    // A loopback-only test socket stands in for a warehouse private-LAN peer.
    const gateway = https.createServer(
      {
        key: readFileSync(`${directory}/server.key`),
        cert: readFileSync(`${directory}/server.pem`),
      },
      (request, response) => {
        Object.defineProperty(request.socket, "remoteAddress", {
          value: "192.168.1.80",
          configurable: true,
        });
        handler(request, response);
      },
    );
    const port = await listen(gateway);
    const fetch = (url, headers = {}) =>
      new Promise((resolve, reject) => {
        const request = https.request(
          {
            hostname: "127.0.0.1",
            port,
            path: url,
            ca: readFileSync(`${directory}/ca.pem`),
            checkServerIdentity: (_host, cert) =>
              checkServerIdentity("192.168.1.25", cert),
            headers: { host: "192.168.1.25:3443", ...headers },
          },
          (response) => {
            let body = "";
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("end", () =>
              resolve({
                status: response.statusCode,
                headers: response.headers,
                body,
              }),
            );
          },
        );
        request.on("error", reject);
        request.end();
      });
    const response = await fetch("/api/auth/session", {
      origin: "https://192.168.1.25:3443",
      "x-forwarded-proto": "http",
      "x-wms-csrf": "fixture-csrf",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body, "api fixture");
    assert.match(response.headers["set-cookie"][0], /; Secure$/);
    assert.equal(observed.origin, "https://192.168.1.25:3443");
    assert.equal(observed["x-wms-csrf"], "fixture-csrf");
    assert.equal(observed["x-forwarded-proto"], undefined);
    assert.equal((await fetch("/work")).body, "web fixture");
    assert.equal(
      (await fetch("/work", { host: "evil.example:3443" })).status,
      403,
    );
    await close(api);
    assert.equal((await fetch("/api/auth/session")).status, 502);
    assert.throws(
      () => gatewayHandler(config, { api: 3443, web: 3080 }),
      /порты/,
    );
  } finally {
    for (const server of servers) {
      if (server.listening) await close(server);
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
