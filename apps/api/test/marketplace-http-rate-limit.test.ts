import assert from "node:assert/strict";
import test from "node:test";
import {
  client,
  createHttpClientForTesting,
  MarketplaceProviderError,
} from "../src/marketplaces/providers/http";
import {
  MARKETPLACE_RUN_REQUEST_LIMIT,
  MARKETPLACE_RUN_TIMEOUT_MS,
} from "../src/marketplaces/providers/request-policy";

const endpoint = "https://api-seller.ozon.ru/v3/product/list";
const stats = "https://statistics-api.wildberries.ru/api/v1/supplier/orders";
const sales = "https://statistics-api.wildberries.ru/api/v1/supplier/sales";
const content = "https://content-api.wildberries.ru/content/v2/get/cards/list";
const supplies = "https://supplies-api.wildberries.ru/api/v1/supplies";
const success = () => new Response('{"ok":true}', { status: 200 });
const limited = (headers: HeadersInit = {}, cancel?: () => void) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("PRIVATE upstream body"));
      },
      cancel,
    }),
    { status: 429, headers },
  );
function clock() {
  let time = Date.UTC(2026, 9, 26);
  const waits: number[] = [];
  return {
    now: () => time,
    random: () => 0,
    wait: async (ms: number, signal: AbortSignal) => {
      if (signal.aborted) throw new Error("abort");
      waits.push(ms);
      time += ms;
    },
    waits,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const providerError = (value: unknown): MarketplaceProviderError => {
  assert.ok(value instanceof MarketplaceProviderError);
  return value;
};

test("429 retries the same read-only request and discards its unread private body", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  let cancelled = 0;
  const request = createHttpClientForTesting(clock())(
    { "Api-Key": "PRIVATE credential" },
    {
      fetch: (async (input, init) => {
        requests.push({ url: String(input), init: init! });
        return requests.length === 1
          ? limited({ "Retry-After": "0" }, () => cancelled++)
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

test("429 has at most five attempts, exponential backoff and no private diagnostics", async () => {
  const time = clock();
  const times: number[] = [];
  const request = createHttpClientForTesting(time)(
    { "Api-Key": "PRIVATE credential" },
    {
      fetch: (async () => {
        times.push(time.now());
        return limited({ "Retry-After": "0" });
      }) as typeof fetch,
    },
  );
  await assert.rejects(request(`${endpoint}?private=PRIVATE`, {}), (value) => {
    const error = providerError(value);
    assert.equal(error.code, "rate_limit");
    assert.deepEqual(error.diagnostic, {
      operation: "/v3/product/list",
      status: 429,
      attempt: 5,
      retryAfterSeconds: 0,
    });
    assert.ok(!JSON.stringify(error).includes("PRIVATE"));
    assert.ok(!error.message.includes("PRIVATE"));
    return true;
  });
  assert.equal(times.length, 5);
  assert.deepEqual(
    times.slice(1).map((t, index) => t - times[index]!),
    [1000, 2000, 4000, 8000],
  );
});

test("missing and invalid Retry-After use exponential fallback with jitter", async () => {
  const time = clock();
  const times: number[] = [];
  const request = createHttpClientForTesting({ ...time, random: () => 0.5 })(
    {},
    {
      fetch: (async () => {
        times.push(time.now());
        return times.length < 3
          ? limited(
              times.length === 1 ? {} : { "Retry-After": "PRIVATE invalid" },
            )
          : success();
      }) as typeof fetch,
    },
  );
  await request(endpoint);
  assert.deepEqual(
    times.slice(1).map((t, index) => t - times[index]!),
    [1125, 2250],
  );
});

test("Retry-After HTTP date and WB-specific headers use the longest valid delay", async () => {
  const time = clock();
  const times: number[] = [];
  const request = createHttpClientForTesting(time)(
    {},
    {
      fetch: (async () => {
        times.push(time.now());
        return times.length === 1
          ? limited({
              "Retry-After": new Date(time.now() + 3000).toUTCString(),
              "X-Ratelimit-Retry": "7",
              "X-Ratelimit-Reset": "5",
            })
          : success();
      }) as typeof fetch,
    },
  );
  await request(supplies);
  assert.equal(times[1]! - times[0]!, 7000);
});

test("WB reset cannot shorten retry, malformed headers do not override a valid delay", async () => {
  const time = clock();
  const times: number[] = [];
  const request = createHttpClientForTesting(time)(
    {},
    {
      fetch: (async () => {
        times.push(time.now());
        return times.length === 1
          ? limited({
              "Retry-After": "4",
              "X-Ratelimit-Reset": "2",
              "X-Ratelimit-Retry": "PRIVATE",
            })
          : success();
      }) as typeof fetch,
    },
  );
  await request(supplies);
  assert.equal(times[1]! - times[0]!, 4000);
});

test("server delay exceeding remaining run budget fails immediately without early retry", async () => {
  for (const header of [
    String(MARKETPLACE_RUN_TIMEOUT_MS / 1000 + 1),
    "9999999999999",
    new Date(Date.UTC(2026, 9, 27)).toUTCString(),
  ]) {
    let attempts = 0;
    const time = clock();
    const request = createHttpClientForTesting(time)(
      {},
      {
        fetch: (async () => {
          attempts++;
          return limited({ "Retry-After": header });
        }) as typeof fetch,
      },
    );
    await assert.rejects(request(endpoint), (value) => {
      assert.equal(providerError(value).code, "rate_limit");
      return true;
    });
    assert.equal(attempts, 1);
    assert.deepEqual(time.waits, []);
  }
});

test("transient 502/503/504 and network errors retry while other statuses do not", async () => {
  for (const status of [0, 502, 503, 504, 400, 401, 403, 404, 500, 302]) {
    const time = clock();
    let attempts = 0;
    const request = createHttpClientForTesting(time)(
      {},
      {
        fetch: (async () => {
          attempts++;
          if (attempts > 1) return success();
          if (status === 0) throw new Error("PRIVATE transport URL key");
          return new Response("PRIVATE body", { status });
        }) as typeof fetch,
      },
    );
    if ([0, 502, 503, 504].includes(status)) {
      assert.deepEqual(await request(endpoint), { ok: true });
      assert.equal(attempts, 2);
    } else {
      await assert.rejects(request(endpoint), (value) => {
        const error = providerError(value);
        assert.equal(
          error.code,
          [401, 403].includes(status) ? "credentials" : "unavailable",
        );
        assert.ok(!JSON.stringify(error).includes("PRIVATE"));
        return true;
      });
      assert.equal(attempts, 1);
    }
  }
});

test("invalid JSON and oversized response are never retried", async () => {
  for (const body of ["PRIVATE malformed", "x".repeat(20_000_001)]) {
    let attempts = 0;
    const request = createHttpClientForTesting(clock())(
      {},
      {
        fetch: (async () => {
          attempts++;
          return new Response(body);
        }) as typeof fetch,
      },
    );
    await assert.rejects(request(endpoint), (value) => {
      assert.equal(providerError(value).code, "invalid_response");
      return true;
    });
    assert.equal(attempts, 1);
  }
});

test("atomic global provider lane spaces simultaneous clients and different Ozon endpoints", async () => {
  const time = clock();
  const times: number[] = [];
  const factory = createHttpClientForTesting(time);
  let inFlight = 0;
  let maximum = 0;
  const fetch = (async () => {
    times.push(time.now());
    maximum = Math.max(maximum, ++inFlight);
    await Promise.resolve();
    inFlight--;
    return success();
  }) as typeof globalThis.fetch;
  await Promise.all([
    factory({}, { fetch })(endpoint),
    factory({}, { fetch })("https://api-seller.ozon.ru/v1/analytics/stocks"),
    factory({}, { fetch })(endpoint),
  ]);
  assert.equal(maximum, 1);
  assert.deepEqual(
    times.slice(1).map((t, index) => t - times[index]!),
    [1000, 1000],
  );
});

test("WB intervals share statistics and supplies groups, unrelated groups remain separate", async () => {
  const time = clock();
  const times: number[] = [];
  const request = createHttpClientForTesting(time)(
    {},
    {
      fetch: (async () => {
        times.push(time.now());
        return success();
      }) as typeof fetch,
    },
  );
  for (const url of [
    stats,
    sales,
    content,
    content,
    supplies,
    `${supplies}/123/goods`,
    "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses",
    "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses",
  ])
    await request(url);
  assert.equal(times[1]! - times[0]!, 61_000);
  assert.equal(times[2]! - times[1]!, 0);
  assert.equal(times[3]! - times[2]!, 650);
  assert.equal(times[5]! - times[4]!, 2100);
  assert.equal(times[7]! - times[6]!, 20_100);
});

test("final failed request preserves provider-wide cooldown for the next client", async () => {
  const time = clock();
  const factory = createHttpClientForTesting(time);
  let attempts = 0;
  const request = factory(
    {},
    {
      fetch: (async () => {
        attempts++;
        return limited({ "Retry-After": "20" });
      }) as typeof fetch,
    },
  );
  await assert.rejects(request(content));
  assert.equal(attempts, 5);
  const failedAt = time.now();
  await factory(
    {},
    {
      fetch: (async () => {
        assert.equal(time.now() - failedAt, 20_000);
        return success();
      }) as typeof fetch,
    },
  )(supplies);
});

test("abort interrupts retry wait without sending another HTTP attempt", async () => {
  const controller = new AbortController();
  let attempts = 0;
  const time = clock();
  const request = createHttpClientForTesting({
    ...time,
    wait: async (_ms, signal) => {
      controller.abort();
      assert.ok(signal.aborted);
      throw new MarketplaceProviderError("aborted", "Загрузка отменена.");
    },
  })(
    {},
    {
      signal: controller.signal,
      fetch: (async () => {
        attempts++;
        return limited({ "Retry-After": "20" });
      }) as typeof fetch,
    },
  );
  await assert.rejects(request(endpoint), (value) => {
    assert.equal(providerError(value).code, "aborted");
    return true;
  });
  assert.equal(attempts, 1);
});

test("cancelled queue waiter cannot release following request ahead of the running body", async () => {
  const factory = createHttpClientForTesting(clock());
  let finish!: () => void;
  let started!: () => void;
  const bodyStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const first = factory(
    {},
    {
      fetch: (async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              started();
              finish = () => {
                controller.enqueue(new TextEncoder().encode("{}"));
                controller.close();
              };
            },
          }),
        )) as typeof fetch,
    },
  )(endpoint);
  await bodyStarted;
  const abort = new AbortController();
  let following = false;
  const cancelled = factory(
    {},
    {
      signal: abort.signal,
      fetch: (async () => {
        throw new Error("must not request");
      }) as typeof fetch,
    },
  )(endpoint);
  const next = factory(
    {},
    {
      fetch: (async () => {
        following = true;
        return success();
      }) as typeof fetch,
    },
  )(endpoint);
  abort.abort();
  await assert.rejects(cancelled, (value) => {
    assert.equal(providerError(value).code, "aborted");
    return true;
  });
  assert.equal(following, false);
  finish();
  await first;
  await next;
  assert.equal(following, true);
});

test("abort interrupts stalled response body and releases queue", async () => {
  const factory = createHttpClientForTesting(clock());
  const abort = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = false;
  const first = factory(
    {},
    {
      signal: abort.signal,
      fetch: (async () =>
        new Response(
          new ReadableStream({
            start() {
              started();
            },
            cancel() {
              cancelled = true;
            },
          }),
        )) as typeof fetch,
    },
  )(endpoint);
  await reading;
  abort.abort();
  await assert.rejects(first, (value) => {
    assert.equal(providerError(value).code, "aborted");
    return true;
  });
  await factory(
    {},
    { fetch: (async () => success()) as typeof fetch },
  )(endpoint);
  assert.equal(cancelled, true);
});

test("all actual attempts count toward run request cap", async () => {
  // Fixture transport remains unpaced; this verifies count, not time policy.
  let attempts = 0;
  const request = client(
    {},
    {
      fetch: (async () => {
        attempts++;
        return success();
      }) as typeof fetch,
    },
  );
  for (let n = 0; n < MARKETPLACE_RUN_REQUEST_LIMIT; n++)
    await request(endpoint);
  await assert.rejects(request(endpoint), (value) => {
    assert.equal(providerError(value).code, "limit");
    return true;
  });
  assert.equal(attempts, MARKETPLACE_RUN_REQUEST_LIMIT);
});

test("unapproved origins, malformed URLs, URL credentials and redirects cannot leak the key", async () => {
  let attempts = 0;
  const request = createHttpClientForTesting(clock())(
    { "Api-Key": "PRIVATE credential" },
    {
      fetch: (async (_input, init) => {
        attempts++;
        assert.equal(init?.redirect, "error");
        return new Response("PRIVATE body", {
          status: 302,
          headers: { Location: "https://example.com/PRIVATE" },
        });
      }) as typeof fetch,
    },
  );
  for (const url of [
    "https://example.com/v3/product/list",
    "PRIVATE invalid URL",
    "https://PRIVATE@api-seller.ozon.ru/v3/product/list",
  ])
    await assert.rejects(request(url), (value) => {
      assert.equal(providerError(value).code, "limit");
      assert.ok(!JSON.stringify(value).includes("PRIVATE"));
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

test("per-attempt timeout covers stalled body reads, then retries a fresh request", async (t) => {
  const timeouts: { ms: number; controller: AbortController }[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    const controller = new AbortController();
    timeouts.push({ ms, controller });
    return controller.signal;
  });
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = false;
  let attempts = 0;
  const request = createHttpClientForTesting(clock())(
    {},
    {
      fetch: (async () => {
        if (++attempts > 1) return success();
        return new Response(
          new ReadableStream(
            {
              pull() {
                started();
              },
              cancel() {
                cancelled = true;
              },
            },
            { highWaterMark: 0 },
          ),
        );
      }) as typeof fetch,
    },
  )(endpoint);
  await reading;
  const attemptTimeout = timeouts.find((timeout) => timeout.ms === 30_000);
  assert.ok(attemptTimeout);
  attemptTimeout.controller.abort();
  assert.deepEqual(await request, { ok: true });
  assert.equal(attempts, 2);
  assert.equal(cancelled, true);
  assert.deepEqual(
    timeouts.map((timeout) => timeout.ms),
    [MARKETPLACE_RUN_TIMEOUT_MS, 30_000, 30_000],
  );
});

test("WB statistics gets a bounded 120-second attempt timeout", async (t) => {
  const durations: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    durations.push(ms);
    return new AbortController().signal;
  });
  await createHttpClientForTesting(clock())(
    {},
    {
      fetch: (async () => success()) as typeof fetch,
    },
  )(stats);
  assert.deepEqual(durations, [MARKETPLACE_RUN_TIMEOUT_MS, 120_000]);
});

test("overflowing server delay cannot poison the provider queue for future imports", async () => {
  const time = clock();
  const factory = createHttpClientForTesting(time);
  let attempts = 0;
  await assert.rejects(
    factory(
      {},
      {
        fetch: (async () => {
          attempts++;
          return limited({ "Retry-After": "9999999999999" });
        }) as typeof fetch,
      },
    )(endpoint),
    (value) => {
      assert.equal(providerError(value).code, "rate_limit");
      return true;
    },
  );
  assert.equal(attempts, 1);
  time.advance(30 * 60_000);
  assert.deepEqual(
    await factory(
      {},
      {
        fetch: (async () => {
          attempts++;
          return success();
        }) as typeof fetch,
      },
    )(endpoint),
    { ok: true },
  );
  assert.equal(attempts, 2);
});
