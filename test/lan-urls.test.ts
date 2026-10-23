import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkInterfaceInfo } from "node:os";

import { listLanUrls } from "../src/server/lan-urls.js";

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/24`,
  };
}

function ipv6(address: string): NetworkInterfaceInfo {
  return {
    address,
    netmask: "ffff:ffff:ffff:ffff::",
    family: "IPv6",
    mac: "00:00:00:00:00:00",
    internal: false,
    cidr: `${address}/64`,
    scopeid: 0,
  };
}

test("lists every non-internal IPv4 address as a URL, sorted", () => {
  const urls = listLanUrls(3000, {
    eth0: [ipv4("192.168.1.20"), ipv6("fe80::1")],
    wlan0: [ipv4("10.0.0.5")],
    lo: [ipv4("127.0.0.1", true)],
  });

  assert.deepEqual(urls, [
    "http://10.0.0.5:3000",
    "http://192.168.1.20:3000",
  ]);
});

test("uses the given port in every URL", () => {
  const urls = listLanUrls(4000, {
    eth0: [ipv4("192.168.1.20")],
  });

  assert.deepEqual(urls, ["http://192.168.1.20:4000"]);
});

test("ignores internal and IPv6-only interfaces", () => {
  const urls = listLanUrls(3000, {
    lo: [ipv4("127.0.0.1", true)],
    eth0: [ipv6("fe80::1")],
  });

  assert.deepEqual(urls, []);
});

test("returns an empty list when there are no interfaces", () => {
  assert.deepEqual(listLanUrls(3000, {}), []);
});
