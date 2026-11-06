/**
 * Test helper: connect a laptop screen to a room and return its host token.
 * The screen is the host for the HTTP control endpoints.
 */
import { WebSocket } from "ws";
import type { ServerMessage } from "../../shared/types.ts";

export interface ScreenClient {
  ws: WebSocket;
  hostToken: string;
  close: () => void;
}

export async function connectScreen(wsUrl: string, roomId: string): Promise<ScreenClient> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "join",
        roomId,
        timestamp: Date.now(),
        payload: { name: "Screen", role: "screen" },
      }));
      resolve();
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("Screen connect timeout")), 5000);
  });

  let hostToken = "";
  await new Promise<void>((resolve, reject) => {
    let joined = false;
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "joined") {
        joined = true;
        if (typeof msg.payload?.hostToken === "string") hostToken = msg.payload.hostToken;
      }
      if (msg.type === "roomState" && joined) {
        ws.removeAllListeners("message");
        resolve();
      }
    });
    setTimeout(() => reject(new Error("Screen ready timeout")), 5000);
  });
  if (!hostToken) throw new Error("screen join must return a host token");
  return { ws, hostToken, close: () => ws.close() };
}

export function hostHeaders(screen: ScreenClient): Record<string, string> {
  return { "Content-Type": "application/json", "x-host-token": screen.hostToken };
}
