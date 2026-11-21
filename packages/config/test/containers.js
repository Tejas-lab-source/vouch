// @ts-check
import { GenericContainer, Wait } from 'testcontainers';

/** Keep these tags in sync with docker-compose.yml. */
export const POSTGRES_IMAGE = 'postgres:17-alpine';
export const REDIS_IMAGE = 'redis:7-alpine';

const STARTUP_TIMEOUT_MS = 120_000;

/** Throwaway credentials for disposable test containers only. */
const TEST_DB = { user: 'vouch_test', password: 'vouch_test', database: 'vouch_test' };

/**
 * @typedef {object} TestContainers
 * @property {string} postgresUrl  Connection URL for the Postgres container.
 * @property {string} redisUrl     Connection URL for the Redis container.
 * @property {() => Promise<void>} stop  Stops and removes both containers.
 */

/**
 * Starts a Postgres 17 container and waits until it accepts connections.
 * @returns {Promise<import('testcontainers').StartedTestContainer>}
 */
function startPostgres() {
  return new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER: TEST_DB.user,
      POSTGRES_PASSWORD: TEST_DB.password,
      POSTGRES_DB: TEST_DB.database,
    })
    .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();
}

/**
 * Starts a Redis 7 container (persistence off) and waits until it is ready.
 * @returns {Promise<import('testcontainers').StartedTestContainer>}
 */
function startRedis() {
  return new GenericContainer(REDIS_IMAGE)
    .withCommand(['redis-server', '--save', '', '--appendonly', 'no'])
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();
}

/**
 * Starts Postgres and Redis containers for integration tests.
 * Call `stop()` in `afterAll` to remove them.
 * @returns {Promise<TestContainers>}
 */
export async function startTestContainers() {
  const [postgres, redis] = await Promise.all([startPostgres(), startRedis()]);
  const { user, password, database } = TEST_DB;
  return {
    postgresUrl: `postgres://${user}:${password}@${postgres.getHost()}:${postgres.getMappedPort(5432)}/${database}`,
    redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    stop: async () => {
      await Promise.all([postgres.stop(), redis.stop()]);
    },
  };
}
