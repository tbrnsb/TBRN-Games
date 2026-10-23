import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const PUBLIC_DIR = path.join(import.meta.dirname, "..", "..", "public");

const PAGES = new Map<string, string>([
  ["/", "index.html"],
  ["/play", "play.html"],
]);

const HTML = "text/html; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";

function send(
  response: http.ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const method = request.method ?? "GET";

  let pathname: string;

  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    send(response, 400, TEXT, "Bad request");
    return;
  }

  if (method === "GET" && pathname === "/api/health") {
    send(response, 200, JSON_TYPE, JSON.stringify({ status: "ok" }));
    return;
  }

  const page = method === "GET" ? PAGES.get(pathname) : undefined;

  if (page) {
    try {
      const html = await readFile(path.join(PUBLIC_DIR, page), "utf8");
      send(response, 200, HTML, html);
    } catch {
      send(response, 500, TEXT, "Internal server error");
    }
    return;
  }

  send(response, 404, TEXT, "Not found");
}

export function createServer(): http.Server {
  return http.createServer((request, response) => {
    void handleRequest(request, response);
  });
}
