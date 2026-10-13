// Minimal local Nostr test relay. It is never used by the application in production.
import { WebSocketServer, WebSocket } from "ws";
import dgram from "node:dgram";
type Event = {
  id: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};
type Filter = { kinds?: number[]; since?: number; "#x"?: string[] };
const setup = async () => {
  // Local STUN creates loopback reflexive candidates in isolated CI namespaces.
  const stun = dgram.createSocket("udp4");
  stun.on("message", (message, remote) => {
    if (message.length < 20 || message.readUInt16BE(0) !== 1) return;
    const response = Buffer.alloc(32);
    response.writeUInt16BE(0x0101, 0);
    response.writeUInt16BE(12, 2);
    message.copy(response, 4, 4, 20);
    response.writeUInt16BE(0x0020, 20);
    response.writeUInt16BE(8, 22);
    response[25] = 1;
    response.writeUInt16BE(remote.port ^ 0x2112, 26);
    remote.address
      .split(".")
      .forEach(
        (part, index) =>
          (response[28 + index] = Number(part) ^ message[4 + index]),
      );
    stun.send(response, remote.port, remote.address);
  });
  await new Promise<void>((resolve) => stun.bind(3479, "127.0.0.1", resolve));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 4127 });
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const events: Event[] = [];
  const subscriptions = new Map<WebSocket, Map<string, Filter>>();
  const matches = (event: Event, filter: Filter) =>
    (!filter.kinds || filter.kinds.includes(event.kind)) &&
    (!filter.since || event.created_at >= filter.since) &&
    (!filter["#x"] ||
      event.tags.some(
        ([key, value]) => key === "x" && filter["#x"]!.includes(value),
      ));
  server.on("connection", (socket) => {
    const subs = new Map<string, Filter>();
    subscriptions.set(socket, subs);
    socket.on("message", (raw) => {
      const [kind, idOrEvent, filter] = JSON.parse(raw.toString());
      if (kind === "REQ") {
        subs.set(idOrEvent, filter);
        for (const event of events)
          if (matches(event, filter))
            socket.send(JSON.stringify(["EVENT", idOrEvent, event]));
        socket.send(JSON.stringify(["EOSE", idOrEvent]));
      } else if (kind === "CLOSE") subs.delete(idOrEvent);
      else if (kind === "EVENT") {
        const event = idOrEvent as Event;
        events.push(event);
        for (const [peer, filters] of subscriptions)
          for (const [id, filter] of filters)
            if (peer.readyState === WebSocket.OPEN && matches(event, filter))
              peer.send(JSON.stringify(["EVENT", id, event]));
        socket.send(JSON.stringify(["OK", event.id, true, ""]));
      }
    });
    socket.on("close", () => subscriptions.delete(socket));
  });
  return async () => {
    stun.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
};
export default setup;
