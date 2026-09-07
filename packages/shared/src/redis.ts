import { Redis } from "ioredis";

export type RedisClient = Redis;

/** Queue publishers must fail promptly; worker blocking connections may wait. */
export function createProducerRedis(url: string): RedisClient {
  return new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 5000,
  });
}

export function createRedis(url: string): RedisClient {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
}
