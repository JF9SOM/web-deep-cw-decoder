import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistedState } from "./usePersistedState";
import { clampWpm, expandMacro, shortenRst } from "../tx/morse";
import {
  AudioTransmitter,
  RigctldTransmitter,
  SerialTransmitter,
  isSerialSupported,
  requestSerialPort,
  type SerialPin,
  type SerialPortLike,
  type Transmitter,
  type TxMethod,
} from "../tx/transmitters";

export const MACRO_COUNT = 12;
export type Macro = { label: string; text: string };

const DEFAULT_MACROS: Macro[] = [
  { label: "CQ", text: "CQ CQ CQ DE {MYCALL} {MYCALL} PSE K" },
  { label: "ANS", text: "{HISCALL} DE {MYCALL} K" },
  { label: "RST", text: "{HISCALL} UR RST {RST} {RST-SHORT} BK" },
  { label: "QTH", text: "QTH TOKYO TOKYO BK" },
  { label: "NAME", text: "NAME OM BK" },
  { label: "AGN", text: "AGN PSE BK" },
  { label: "TU", text: "TU 73 {HISCALL} DE {MYCALL} <SK>" },
  { label: "CALL", text: "{MYCALL}" },
  { label: "HIS", text: "{HISCALL}" },
  { label: "?", text: "?" },
  { label: "73", text: "73 E E" },
  { label: "QRZ?", text: "QRZ? DE {MYCALL}" },
];

const isMethod = (v: unknown): v is TxMethod =>
  v === "audio" || v === "serial" || v === "rigctld";
const isPin = (v: unknown): v is SerialPin => v === "DTR" || v === "RTS";
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isMacros = (v: unknown): v is Macro[] =>
  Array.isArray(v) &&
  v.length === MACRO_COUNT &&
  v.every(
    (m) =>
      m && typeof m === "object" && isString(m.label) && isString(m.text),
  );

const K = (name: string) => `tx.${name}`;

export const useCwTransmit = () => {
  const [method, setMethod] = usePersistedState<TxMethod>(K("method"), "audio", isMethod);
  const [wpm, setWpm] = usePersistedState<number>(K("wpm"), 20, isNumber);
  const [toneHz, setToneHz] = usePersistedState<number>(K("toneHz"), 700, isNumber);
  const [volume, setVolume] = usePersistedState<number>(K("volume"), 0.5, isNumber);
  const [sinkId, setSinkId] = usePersistedState<string>(K("sinkId"), "", isString);
  const [serialPin, setSerialPin] = usePersistedState<SerialPin>(K("serialPin"), "DTR", isPin);
  const [bridgeUrl, setBridgeUrl] = usePersistedState<string>(
    K("bridgeUrl"),
    "http://127.0.0.1:4540",
    isString,
  );
  const [myCall, setMyCall] = usePersistedState<string>(K("myCall"), "", isString);
  const [hisCall, setHisCall] = usePersistedState<string>(K("hisCall"), "", isString);
  const [rst, setRst] = usePersistedState<string>(K("rst"), "599", isString);
  const [macros, setMacros] = usePersistedState<Macro[]>(K("macros"), DEFAULT_MACROS, isMacros);

  const [serialPort, setSerialPort] = useState<SerialPortLike | null>(null);
  const [sendingText, setSendingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Latest settings for transmitters/handlers without re-creating them.
  const live = useRef({
    method, wpm, toneHz, volume, sinkId, serialPin, bridgeUrl,
    myCall, hisCall, rst, serialPort,
  });
  useEffect(() => {
    live.current = {
      method, wpm, toneHz, volume, sinkId, serialPin, bridgeUrl,
      myCall, hisCall, rst, serialPort,
    };
  });

  const transmitters = useMemo<Record<TxMethod, Transmitter>>(
    () => ({
      audio: new AudioTransmitter(() => ({
        toneHz: live.current.toneHz,
        volume: live.current.volume,
        sinkId: live.current.sinkId,
      })),
      serial: new SerialTransmitter(
        () => live.current.serialPort,
        () => live.current.serialPin,
      ),
      rigctld: new RigctldTransmitter(() => live.current.bridgeUrl),
    }),
    [],
  );

  const seq = useRef(0);

  const stop = useCallback(() => {
    seq.current += 1;
    Object.values(transmitters).forEach((t) => t.stop());
    setSendingText(null);
  }, [transmitters]);

  /** Stops anything in progress, then sends `raw` (macro variables expanded). */
  const send = useCallback(
    (raw: string) => {
      const l = live.current;
      const text = expandMacro(raw, {
        MYCALL: l.myCall.trim(),
        HISCALL: l.hisCall.trim(),
        RST: l.rst.trim(),
        "RST-SHORT": shortenRst(l.rst.trim()),
      })
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return;
      Object.values(transmitters).forEach((t) => t.stop());
      const mine = ++seq.current;
      setError(null);
      setSendingText(text);
      transmitters[l.method]
        .send(text, clampWpm(l.wpm))
        .catch((e: unknown) => {
          if (seq.current === mine) {
            setError(e instanceof Error ? e.message : String(e));
          }
        })
        .finally(() => {
          if (seq.current === mine) setSendingText(null);
        });
    },
    [transmitters],
  );

  const connectSerial = useCallback(async () => {
    try {
      setError(null);
      await live.current.serialPort?.close().catch(() => undefined);
      setSerialPort(await requestSerialPort());
    } catch (e) {
      // Closing the chooser dialog is not an error worth showing.
      if (!(e instanceof DOMException && e.name === "NotFoundError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  const disconnectSerial = useCallback(async () => {
    stop();
    await live.current.serialPort?.close().catch(() => undefined);
    setSerialPort(null);
  }, [stop]);

  // F1..F12 send the macro immediately; Esc aborts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("[data-no-fkey]")) return;
      if (e.key === "Escape") {
        stop();
        return;
      }
      const m = /^F(\d{1,2})$/.exec(e.key);
      if (!m) return;
      const idx = Number(m[1]) - 1;
      if (idx < 0 || idx >= MACRO_COUNT) return;
      e.preventDefault(); // F5 reload, F11 fullscreen, etc.
      send(macros[idx].text);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [macros, send, stop]);

  // Release the key if the component unmounts mid-transmission.
  useEffect(() => stop, [stop]);

  const updateMacro = (index: number, patch: Partial<Macro>) =>
    setMacros((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    );

  return {
    method, setMethod, wpm, setWpm, toneHz, setToneHz, volume, setVolume,
    sinkId, setSinkId, serialPin, setSerialPin, bridgeUrl, setBridgeUrl,
    myCall, setMyCall, hisCall, setHisCall, rst, setRst,
    macros, updateMacro,
    serialSupported: isSerialSupported(),
    serialConnected: serialPort !== null,
    connectSerial, disconnectSerial,
    sendingText, error, send, stop,
  };
};
