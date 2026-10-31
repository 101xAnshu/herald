import Redis from "ioredis";

import { loadConfig } from "@herald/config";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface BucketResult {
  allowed: boolean;
  remaining: number;
}

export interface RateLimitRequest {
  scope: string;
  id: string;
  limit: number;
  windowSeconds: number;
}

const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

const TOKEN_BUCKET_SCRIPT = `
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local cost = tonumber(ARGV[4])
local now = tonumber(ARGV[3])
local values = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(values[1])
local ts = tonumber(values[2])
if tokens == nil then tokens = capacity end
if ts == nil then ts = now end
tokens = math.min(capacity, tokens + math.max(0, now - ts) / 1000 * refill)
local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return { allowed, tostring(tokens) }
`;

export class RedisStore {
  private readonly client: Redis;
  private subscriber: Redis | undefined;

  constructor(url?: string) {
    this.client = new Redis(url ?? loadConfig().redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  }

  get raw(): Redis {
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incrementWindow(key: string, windowSeconds: number): Promise<{ count: number; ttlSeconds: number }> {
    const [count, ttlMs] = (await this.client.eval(
      RATE_LIMIT_SCRIPT,
      1,
      key,
      String(windowSeconds * 1000),
    )) as [number, number];

    return { count, ttlSeconds: Math.max(1, Math.ceil(ttlMs / 1000)) };
  }

  async rateLimit(
    scope: string,
    id: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `ratelimit:${scope}:${id}:${bucket}`;
    const { count, ttlSeconds } = await this.incrementWindow(key, windowSeconds);

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetSeconds: ttlSeconds,
    };
  }

  async rateLimitMany(requests: readonly RateLimitRequest[]): Promise<RateLimitResult[]> {
    if (requests.length === 0) {
      return [];
    }

    const pipeline = this.client.pipeline();

    for (const request of requests) {
      const bucket = Math.floor(Date.now() / (request.windowSeconds * 1000));
      const key = `ratelimit:${request.scope}:${request.id}:${bucket}`;
      pipeline.eval(RATE_LIMIT_SCRIPT, 1, key, String(request.windowSeconds * 1000));
    }

    const results = await pipeline.exec();

    return requests.map((request, index) => {
      const entry = results?.[index];
      const value = entry?.[1] as [number, number] | undefined;
      const count = value?.[0] ?? 0;
      const ttlMs = value?.[1] ?? 1000;

      return {
        allowed: count <= request.limit,
        limit: request.limit,
        remaining: Math.max(0, request.limit - count),
        resetSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
      };
    });
  }

  async takeToken(
    key: string,
    capacity: number,
    refillPerSecond: number,
    cost = 1,
  ): Promise<BucketResult> {
    const [allowed, remaining] = (await this.client.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      key,
      String(capacity),
      String(refillPerSecond),
      String(Date.now()),
      String(cost),
      "3600000",
    )) as [number, string];

    return { allowed: allowed === 1, remaining: Number(remaining) };
  }

  async hasDedupe(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async markDedupe(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.client.publish(channel, JSON.stringify(payload));
  }

  async subscribe(channel: string, handler: (payload: unknown) => void): Promise<() => Promise<void>> {
    if (!this.subscriber) {
      this.subscriber = this.client.duplicate();

      if (this.subscriber.status === "wait") {
        await this.subscriber.connect();
      }
    }

    const listener = (incoming: string) => {
      try {
        handler(JSON.parse(incoming) as unknown);
      } catch {
        handler(incoming);
      }
    };

    await this.subscriber.subscribe(channel);
    this.subscriber.on("message", (incomingChannel, message) => {
      if (incomingChannel === channel) {
        listener(message);
      }
    });

    return async () => {
      await this.subscriber?.unsubscribe(channel);
    };
  }

  async hset(key: string, values: Record<string, string>): Promise<void> {
    await this.client.hset(key, values);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  async disconnect(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
    await this.client.quit().catch(() => undefined);
  }
}

export const createRedisStore = (): RedisStore => new RedisStore();
