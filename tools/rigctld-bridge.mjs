#!/usr/bin/env node
// Local HTTP -> TCP relay so the browser can talk to Hamlib's rigctld.
//
//   rigctld -m <model> -r <device> -t 4532      # start rigctld first
//   node tools/rigctld-bridge.mjs [--port 4540] [--rig-host 127.0.0.1] [--rig-port 4532]
//
// POST /cmd with a rigctld command as the body (e.g. "\send_morse CQ DE JF9SOM").
// Replies with rigctld's raw response. Binds to loopback only.
import http from "node:http";
import net from "node:net";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const PORT = Number(args.port ?? 4540);
const RIG_HOST = args["rig-host"] ?? "127.0.0.1";
const RIG_PORT = Number(args["rig-port"] ?? 4532);
// Origins allowed to call the bridge (CORS). Add your deployed origin if needed.
const ALLOWED = new Set(
  (args.origins ?? "http://localhost:5173,http://127.0.0.1:5173,https://jf9som.github.io").split(","),
);

const rig = (cmd) =>
  new Promise((resolve, reject) => {
    const sock = net.connect(RIG_PORT, RIG_HOST);
    let out = "";
    const timer = setTimeout(() => sock.destroy(new Error("rigctld timeout")), 3000);
    sock.on("connect", () => sock.write(cmd.trim() + "\n"));
    sock.on("data", (d) => {
      out += d;
      // Every rigctld reply ends with an "RPRT n" line or a value line; for
      // set-type commands that is RPRT. Close once we have a full line.
      if (/RPRT -?\d+\n$/.test(out)) sock.end();
    });
    sock.on("close", () => { clearTimeout(timer); resolve(out); });
    sock.on("error", (e) => { clearTimeout(timer); reject(e); });
  });

http
  .createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (req.method !== "POST" || req.url !== "/cmd") return res.writeHead(404).end();
    if (origin && !ALLOWED.has(origin)) return res.writeHead(403).end("origin not allowed");

    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024) return res.writeHead(413).end();
    }
    try {
      const reply = await rig(body.replace(/[\r\n]+/g, " "));
      res.writeHead(200, { "Content-Type": "text/plain" }).end(reply);
    } catch (e) {
      res.writeHead(502, { "Content-Type": "text/plain" }).end(String(e.message ?? e));
    }
  })
  .listen(PORT, "127.0.0.1", () =>
    console.log(`rigctld bridge on http://127.0.0.1:${PORT} -> ${RIG_HOST}:${RIG_PORT}`),
  );
