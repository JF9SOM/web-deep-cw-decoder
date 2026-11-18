import { textToElements, type KeyElement } from "./morse";

export type TxMethod = "audio" | "serial" | "rigctld";
export type SerialPin = "DTR" | "RTS";

export interface Transmitter {
  /** Resolves when sending finishes or is stopped. Rejects on I/O error. */
  send(text: string, wpm: number): Promise<void>;
  /** Abort the current transmission immediately and release the key. */
  stop(): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Audio ---

export type AudioTxOptions = {
  toneHz: number;
  volume: number; // 0..1
  sinkId: string; // "" = default device
};

/** Keyed sine tone through Web Audio. Sample-accurate scheduling. */
export class AudioTransmitter implements Transmitter {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private finish: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private getOptions: () => AudioTxOptions;

  constructor(getOptions: () => AudioTxOptions) {
    this.getOptions = getOptions;
  }

  async send(text: string, wpm: number): Promise<void> {
    this.stop();
    const elements = textToElements(text, wpm);
    if (elements.length === 0) return;
    const { toneHz, volume, sinkId } = this.getOptions();

    const ctx = new AudioContext();
    this.ctx = ctx;
    if (sinkId && "setSinkId" in ctx) {
      try {
        await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(sinkId);
      } catch {
        // Fall back to the default output device.
      }
    }
    if (this.ctx !== ctx) return; // stopped while waiting
    await ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = toneHz;
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    this.osc = osc;
    this.gain = gain;

    const ramp = 0.005; // 5 ms edges avoid key clicks
    let t = ctx.currentTime + 0.05;
    for (const el of elements) {
      const d = el.ms / 1000;
      if (el.on) {
        gain.gain.setTargetAtTime(volume, t, ramp / 3);
        gain.gain.setTargetAtTime(0, t + d, ramp / 3);
      }
      t += d;
    }
    const total = (t - ctx.currentTime) * 1000 + 100;

    return new Promise<void>((resolve) => {
      this.finish = resolve;
      this.timer = setTimeout(() => this.stop(), total);
    });
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.osc?.stop();
    } catch {
      // already stopped
    }
    this.osc?.disconnect();
    this.gain?.disconnect();
    void this.ctx?.close().catch(() => undefined);
    this.osc = this.gain = this.ctx = null;
    const done = this.finish;
    this.finish = null;
    done?.();
  }
}

// --------------------------------------------------------------- Serial ---

// Minimal Web Serial typings (not in lib.dom for all TS versions).
type SerialSignals = {
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
};
export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  setSignals(signals: SerialSignals): Promise<void>;
}
type NavigatorWithSerial = Navigator & {
  serial?: { requestPort(): Promise<SerialPortLike> };
};

export const isSerialSupported = () =>
  typeof navigator !== "undefined" && "serial" in navigator;

export const requestSerialPort = async (): Promise<SerialPortLike> => {
  const serial = (navigator as NavigatorWithSerial).serial;
  if (!serial) throw new Error("Web Serial is not supported in this browser");
  const port = await serial.requestPort();
  await port.open({ baudRate: 9600 });
  // Make sure the key line starts released.
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  return port;
};

/** Keys a rig through the DTR or RTS control line of a USB serial port. */
export class SerialTransmitter implements Transmitter {
  private abort = false;
  private active = false;

  private getPort: () => SerialPortLike | null;
  private getPin: () => SerialPin;

  constructor(getPort: () => SerialPortLike | null, getPin: () => SerialPin) {
    this.getPort = getPort;
    this.getPin = getPin;
  }

  private async setKey(port: SerialPortLike, pin: SerialPin, down: boolean) {
    await port.setSignals(
      pin === "DTR" ? { dataTerminalReady: down } : { requestToSend: down },
    );
  }

  async send(text: string, wpm: number): Promise<void> {
    const port = this.getPort();
    if (!port) throw new Error("Serial port not connected");
    const pin = this.getPin();
    const elements: KeyElement[] = textToElements(text, wpm);
    this.abort = false;
    this.active = true;
    try {
      // Wake the port up first: the first setSignals call can be slow, and its
      // delay must not eat into the first elements.
      await this.setKey(port, pin, false);
      let deadline = performance.now();
      for (const el of elements) {
        if (this.abort) break;
        await this.setKey(port, pin, el.on);
        // Measure each element from when the line actually changed, so a slow
        // setSignals call never shortens (or collapses) an element. Otherwise
        // deadlines stay absolute, so setTimeout jitter does not accumulate.
        deadline = Math.max(deadline, performance.now()) + el.ms;
        const wait = deadline - performance.now();
        if (wait > 0) await sleep(wait);
      }
    } finally {
      this.active = false;
      await this.setKey(port, pin, false).catch(() => undefined);
    }
  }

  stop(): void {
    if (!this.active) return;
    this.abort = true;
    const port = this.getPort();
    if (port) void this.setKey(port, this.getPin(), false).catch(() => undefined);
  }
}

// -------------------------------------------------------------- rigctld ---

/**
 * rigctld speaks raw TCP, which browsers cannot open. tools/rigctld-bridge.mjs
 * is a tiny local HTTP -> TCP relay; this class talks to it.
 */
export class RigctldTransmitter implements Transmitter {
  private getBridgeUrl: () => string;

  constructor(getBridgeUrl: () => string) {
    this.getBridgeUrl = getBridgeUrl;
  }

  private async command(cmd: string): Promise<string> {
    const res = await fetch(`${this.getBridgeUrl().replace(/\/$/, "")}/cmd`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: cmd,
    });
    if (!res.ok) throw new Error(`rigctld bridge: HTTP ${res.status}`);
    const body = await res.text();
    if (/^RPRT\s+-\d+/m.test(body)) throw new Error(`rigctld: ${body.trim()}`);
    return body;
  }

  async send(text: string, wpm: number): Promise<void> {
    let clean = text.replace(/[\r\n]+/g, " ").trim();
    if (!clean) return;
    // Hamlib's Yaesu backend (newcat) treats a one-character message as a
    // keyer memory number (1-5) instead of text, so "?" fails. A trailing
    // space makes it a normal two-character text message.
    if (clean.length === 1) clean += " ";
    // Replaces whatever the rig is currently sending, then sets speed and sends.
    await this.command("\\stop_morse").catch(() => undefined);
    await this.command(`L KEYSPD ${wpm}`).catch(() => undefined);
    await this.command(`\\send_morse ${clean}`);
  }

  stop(): void {
    void this.command("\\stop_morse").catch(() => undefined);
  }
}
