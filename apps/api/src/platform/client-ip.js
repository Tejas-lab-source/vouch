// @ts-check
import { BlockList, isIP } from 'node:net';

/** `::ffff:203.0.113.7` → `203.0.113.7`, so IPv4 rules match IPv4-mapped sockets. */
const unmapped = (/** @type {string} */ address) =>
  address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;

/**
 * Which addresses are trusted proxies (`TRUSTED_PROXIES`, ADR 0015).
 * @param {readonly string[]} entries  IPs or CIDRs, IPv4 or IPv6.
 */
export function createProxyTrust(entries) {
  const list = new BlockList();
  for (const entry of entries) {
    const [address = '', prefix] = entry.split('/');
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) list.addAddress(address, family);
    else list.addSubnet(address, Number(prefix), family);
  }
  /** @param {string | undefined} address */
  const isTrusted = (address) => {
    if (!address || entries.length === 0) return false;
    const plain = unmapped(address);
    const family = isIP(plain);
    if (family === 0) return false;
    return list.check(plain, family === 6 ? 'ipv6' : 'ipv4');
  };
  return {
    isTrusted,
    /**
     * Fastify's `trustProxy`: forwarded addresses are walked from the right, skipping hops
     * that are trusted proxies; nothing is believed when the list is empty.
     * @param {string} address
     */
    trustProxy: (address) => isTrusted(address),
  };
}

/**
 * The client's IP for one request: `CF-Connecting-IP` when the request came from a trusted
 * proxy and the header holds a valid IP; otherwise `request.ip`, which Fastify derives from
 * `X-Forwarded-For` only across trusted hops, and which is the socket address when the
 * request did not come from a trusted proxy.
 * @param {import('fastify').FastifyRequest} request
 * @param {ReturnType<typeof createProxyTrust>} trust
 */
export function resolveClientIp(request, trust) {
  const socket = request.socket.remoteAddress;
  const header = request.headers['cf-connecting-ip'];
  if (typeof header === 'string' && trust.isTrusted(socket) && isIP(header.trim()) !== 0) {
    return unmapped(header.trim());
  }
  return unmapped(request.ip);
}

/**
 * The resolved client IP set by the HTTP server (`request.clientIp`). Route adapters use this
 * instead of `request.ip`.
 * @param {import('fastify').FastifyRequest} request
 * @returns {string}
 */
export function clientIpOf(request) {
  return /** @type {any} */ (request).clientIp ?? request.ip;
}
