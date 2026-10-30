import os from "node:os";

/**
 * Returns an HTTP URL for every non-internal IPv4 address, sorted for stable
 * output. `interfaces` is injectable so it can be tested without real network
 * hardware.
 */
export function listLanUrls(
  port: number,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string[] {
  const addresses = new Set<string>();

  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      if (entry.internal || entry.family !== "IPv4") {
        continue;
      }

      addresses.add(entry.address);
    }
  }

  return [...addresses]
    .sort((left, right) => left.localeCompare(right))
    .map((address) => `http://${address}:${port}`);
}
