import type { Request } from 'express';

/**
 * The client IP, trusting exactly `trustedProxyHops` entries of X-Forwarded-For (the ones
 * appended by our own proxies). Trusting more would let clients spoof their address and
 * dodge rate limits.
 */
export function resolveClientAddress(request: Request, trustedProxyHops: number): string {
  const socketAddress = normaliseAddress(request.socket.remoteAddress ?? 'unknown');
  if (trustedProxyHops === 0) return socketAddress;
  const forwardedHeader = request.headers['x-forwarded-for'];
  const forwardedText = Array.isArray(forwardedHeader) ? forwardedHeader.join(',') : (forwardedHeader ?? '');
  const forwardedAddresses = forwardedText
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address !== '');
  const clientIndex = forwardedAddresses.length - trustedProxyHops;
  const clientAddress = clientIndex >= 0 ? forwardedAddresses[clientIndex] : forwardedAddresses[0];
  return clientAddress === undefined ? socketAddress : normaliseAddress(clientAddress);
}

const IPV4_MAPPED_PREFIX = '::ffff:';

/**
 * One spelling per address, so a block typed by an admin matches what requests report:
 * IPv4-mapped IPv6 (`::ffff:1.2.3.4`) becomes plain IPv4 and IPv6 is lower-cased and compressed.
 */
export function normaliseAddress(address: string): string {
  const lowerCased = address.trim().toLowerCase();
  const unmapped =
    lowerCased.startsWith(IPV4_MAPPED_PREFIX) && lowerCased.includes('.')
      ? lowerCased.slice(IPV4_MAPPED_PREFIX.length)
      : lowerCased;
  if (!unmapped.includes(':')) return unmapped;
  try {
    return new URL(`http://[${unmapped}]`).hostname.slice(1, -1);
  } catch {
    return unmapped;
  }
}
