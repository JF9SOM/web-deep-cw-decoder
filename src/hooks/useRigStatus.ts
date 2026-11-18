import { useEffect, useRef, useState } from "react";

export type RigStatus = { freqMhz: number; mode: string };

const POLL_MS = 2000;
const BACKOFF_MS = 15000; // when the bridge/rigctld is not reachable

const post = async (base: string, cmd: string): Promise<string> => {
  const res = await fetch(`${base.replace(/\/$/, "")}/cmd`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: cmd,
  });
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  const body = await res.text();
  if (/^RPRT\s+-\d+/m.test(body)) throw new Error(body.trim());
  return body;
};

/** Reads the current frequency and mode (read-only) via the rigctld bridge. */
export const readRigStatus = async (bridgeUrl: string): Promise<RigStatus> => {
  const freqHz = Number((await post(bridgeUrl, "\\get_freq")).trim().split(/\s+/)[0]);
  const mode = (await post(bridgeUrl, "\\get_mode")).trim().split(/\s+/)[0] ?? "";
  if (!Number.isFinite(freqHz) || freqHz <= 0 || !mode) {
    throw new Error("unexpected rigctld reply");
  }
  return { freqMhz: freqHz / 1e6, mode };
};

/** Polls the rig; `status` is null while the bridge or rigctld is unreachable. */
export const useRigStatus = (bridgeUrl: string) => {
  const [status, setStatus] = useState<RigStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      let next = POLL_MS;
      try {
        const s = await readRigStatus(bridgeUrl);
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) setStatus(null);
        next = BACKOFF_MS;
      }
      if (!cancelled) timer.current = setTimeout(() => void tick(), next);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [bridgeUrl]);

  return { status };
};
