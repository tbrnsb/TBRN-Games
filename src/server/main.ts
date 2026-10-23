import { createServer } from "./app.js";
import { resolvePort } from "./config.js";
import { listLanUrls } from "./lan-urls.js";
import { attachGameSocket } from "./ws.js";

const HOST = "0.0.0.0";

let port: number;

try {
  port = resolvePort(process.env.PORT);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const server = createServer();
attachGameSocket(server);

server.on("error", (error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});

server.listen(port, HOST, () => {
  const address = server.address();
  const boundPort =
    address !== null && typeof address === "object" ? address.port : port;

  console.log(`TBRN-Games server listening on port ${boundPort} (${HOST}).`);
  console.log(`Laptop screen: http://localhost:${boundPort}/`);

  const lanUrls = listLanUrls(boundPort);

  if (lanUrls.length === 0) {
    console.log("No usable LAN IPv4 address found. Check your network connection.");
    return;
  }

  console.log("Phones on the same Wi-Fi:");
  for (const url of lanUrls) {
    console.log(`  ${url}/play`);
  }
});
