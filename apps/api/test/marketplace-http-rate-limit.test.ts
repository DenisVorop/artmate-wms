import assert from "node:assert/strict";
import test from "node:test";
import {
  client,
  MarketplaceProviderError,
} from "../src/marketplaces/providers/http";

const endpoint = "https://api-seller.ozon.ru/v3/product/list";
const success = () => new Response('{"ok":true}', { status: 200 });
const limited = (retryAfter?: string, cancel?: () => void) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("PRIVATE upstream body"));
      },
      cancel,
    }),
    {
      status: 429,
      headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
    },
  );
const providerError = (value: unknown): MarketplaceProviderError => {
  assert.ok(value instanceof MarketplaceProviderError);
  return value;
};

test("429 retries the same read-only request and cancels its unread body", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  let cancelled = 0;
  const request = client(
    { "Api-Key": "PRIVATE credential" },
    {
      fetch: (async (input, init) => {
        requests.push({ url: String(input), init: init! });
        return requests.length === 1
          ? limited("0", () => cancelled++)
          : success();
      }) as typeof fetch,
    },
  );
  assert.deepEqual(await request(endpoint, { limit: 1000 }), { ok: true });
  assert.equal(cancelled, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.url, requests[1]!.url);
  for (const { init } of requests) {
    assert.equal(init.method, "POST");
    assert.equal(init.body, '{"limit":1000}');
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    assert.deepEqual(init.headers, requests[0]!.init.headers);
  }
});

test("429 stops after two retries with allowlisted diagnostic and no private data", async () => {
  let attempts = 0;
  const request = client(
    { "Api-Key": "PRIVATE credential" },
    {
      fetch: (async () => {
        attempts++;
        return limited("0");
      }) as typeof fetch,
    },
  );
  await assert.rejects(request(`${endpoint}?private=PRIVATE`, {}), (value) => {
    const error = providerError(value);
    assert.equal(error.code, "rate_limit");
    assert.deepEqual(error.diagnostic, {
      operation: "/v3/product/list",
      status: 429,
      attempt: 3,
      retryAfterSeconds: 0,
    });
    assert.ok(!JSON.stringify(error).includes("PRIVATE"));
    assert.ok(!error.message.includes("PRIVATE"));
    return true;
  });
  assert.equal(attempts, 3);
});

test("missing and invalid Retry-After use one then two second fallback", async () => {
  const times: number[] = [];
  const request = client(
    {},
    {
      fetch: (async () => {
        times.push(Date.now());
        return times.length === 1
          ? limited()
          : times.length === 2
            ? limited("PRIVATE invalid header")
            : success();
      }) as typeof fetch,
    },
  );
  await request(endpoint);
  assert.equal(times.length, 3);
  assert.ok(times[1]! - times[0]! >= 990);
  assert.ok(times[2]! - times[1]! >= 1990);
});

test("Retry-After HTTP date is honored rather than replaced by the fallback", async () => {
  let attempts = 0;
  const date = new Date(Date.now() + 2500).toUTCString();
  const request = client(
    {},
    {
      fetch: (async () => {
        attempts++;
        if (attempts === 1) return limited(date);
        assert.ok(Date.now() >= Date.parse(date));
        return success();
      }) as typeof fetch,
    },
  );
  await request(endpoint);
  assert.equal(attempts, 2);
});

test("server delays exceeding remaining budget fail immediately without an early retry", async () => {
  for (const header of [
    "241",
    "9999999999999999999999999999999999999999999999999999999999",
    new Date(Date.now() + 600_000).toUTCString(),
  ]) {
    let attempts = 0;
    const request = client(
      {},
      {
        fetch: (async () => {
          attempts++;
          return limited(header);
        }) as typeof fetch,
      },
    );
    const started = Date.now();
    await assert.rejects(request(endpoint), (value) => {
      assert.equal(providerError(value).code, "rate_limit");
      return true;
    });
    assert.equal(attempts, 1);
    assert.ok(Date.now() - started < 1000);
  }
});

test("abort interrupts retry waiting and sends no further HTTP attempt", async () => {
  let attempts = 0;
  const controller = new AbortController();
  const request = client(
    {},
    {
      signal: controller.signal,
      fetch: (async () => {
        attempts++;
        setTimeout(() => controller.abort(), 20);
        return limited("20");
      }) as typeof fetch,
    },
  );
  await assert.rejects(request(endpoint), (value) => {
    assert.equal(providerError(value).code, "aborted");
    return true;
  });
  assert.equal(attempts, 1);
});

test("real transport pacing applies to every Ozon retry", async (t) => {
  const times: number[] = [];
  t.mock.method(globalThis, "fetch", async () => {
    times.push(Date.now());
    return times.length <= 2 ? limited("0") : success();
  });
  await client({}, {})(endpoint);
  assert.equal(times.length, 3);
  assert.ok(times[1]! - times[0]! >= 240);
  assert.ok(times[2]! - times[1]! >= 240);
});

test("zero Retry-After cannot bypass long WB endpoint pacing", async (t) => {
  for (const url of [
    "https://statistics-api.wildberries.ru/api/v1/supplier/orders",
    "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses",
  ]) {
    const controller = new AbortController();
    let attempts = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      attempts++;
      setTimeout(() => controller.abort(), 20);
      return limited("0");
    });
    await assert.rejects(
      client({}, { signal: controller.signal })(url),
      (value) => {
        assert.equal(providerError(value).code, "aborted");
        return true;
      },
    );
    assert.equal(attempts, 1);
    mock.mock.restore();
  }
});

test("all actual retry attempts count toward the 180 request run limit", async () => {
  let attempts = 0;
  const request = client(
    {},
    {
      fetch: (async () => {
        attempts++;
        return attempts % 2 === 1 ? limited("0") : success();
      }) as typeof fetch,
    },
  );
  for (let n = 0; n < 90; n++) await request(endpoint);
  assert.equal(attempts, 180);
  await assert.rejects(request(endpoint), (value) => {
    assert.equal(providerError(value).code, "limit");
    return true;
  });
  assert.equal(attempts, 180);
});

test("unapproved origins, credentials in URLs and redirects cannot leak the key", async () => {
  let attempts = 0;
  const request = client(
    { "Api-Key": "PRIVATE credential" },
    {
      fetch: (async (_input, init) => {
        attempts++;
        assert.equal(init?.redirect, "error");
        return new Response("PRIVATE upstream body", {
          status: 302,
          headers: { Location: "https://example.com/PRIVATE" },
        });
      }) as typeof fetch,
    },
  );
  for (const url of [
    "https://example.com/v3/product/list",
    "https://PRIVATE@api-seller.ozon.ru/v3/product/list",
  ])
    await assert.rejects(request(url), (value) => {
      const error = providerError(value);
      assert.equal(error.code, "limit");
      assert.ok(!JSON.stringify(error).includes("PRIVATE"));
      return true;
    });
  assert.equal(attempts, 0);
  await assert.rejects(request(endpoint), (value) => {
    const error = providerError(value);
    assert.equal(error.code, "unavailable");
    assert.equal(error.diagnostic?.status, 302);
    assert.ok(!JSON.stringify(error).includes("PRIVATE"));
    return true;
  });
  assert.equal(attempts, 1);
});
