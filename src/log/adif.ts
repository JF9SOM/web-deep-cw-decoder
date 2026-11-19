// Pure helpers to build one ADIF record for a QSO. No browser APIs.

const BANDS: readonly [string, number, number][] = [
  ["160m", 1.8, 2.0],
  ["80m", 3.5, 4.0],
  ["60m", 5.06, 5.45],
  ["40m", 7.0, 7.3],
  ["30m", 10.1, 10.15],
  ["20m", 14.0, 14.35],
  ["17m", 18.068, 18.168],
  ["15m", 21.0, 21.45],
  ["12m", 24.89, 24.99],
  ["10m", 28.0, 29.7],
  ["6m", 50.0, 54.0],
  ["4m", 70.0, 70.5],
  ["2m", 144.0, 148.0],
  ["70cm", 420.0, 450.0],
  ["23cm", 1240.0, 1300.0],
];

/** Frequency in MHz -> ADIF band, or "" when outside the known amateur bands. */
export const freqToBand = (mhz: number): string =>
  BANDS.find(([, lo, hi]) => mhz >= lo && mhz <= hi)?.[0] ?? "";

/** Hamlib mode name -> ADIF MODE (+ SUBMODE where ADIF defines one). */
export const adifMode = (rigMode: string): { mode: string; submode?: string } => {
  const m = rigMode.trim().toUpperCase();
  if (m === "CW" || m === "CWR") return { mode: "CW" }; // CWR is not an ADIF mode
  if (m === "USB" || m === "LSB") return { mode: "SSB", submode: m };
  return { mode: m };
};

const byteLength = (s: string) => new TextEncoder().encode(s).length;

const field = (name: string, value: string | undefined): string =>
  value ? `<${name}:${byteLength(value)}>${value}` : "";

/** JA callsigns (DXCC 339). JD1 (Ogasawara, DXCC 177/192) is deliberately excluded. */
export const isJapaneseCall = (call: string): boolean =>
  /^(J[A-CE-S]|7[J-N]|8[J-N])\d/i.test(call.trim());

/** JCC (4 or 6 digits, incl. Ku) / JCG (5 digits) numbers, as used in ADIF CNTY for Japan. */
export const isJccJcgNumber = (value: string): boolean => /^\d{4,6}$/.test(value.trim());

export type Qso = {
  call: string;
  date: Date; // logged in UTC
  freqMhz: number;
  rigMode: string;
  rstSent: string;
  rstRcvd: string;
  name?: string;
  qth?: string;
  /** ADIF CNTY: JCC/JCG number for Japanese stations. */
  county?: string;
  stationCall?: string;
};

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export const adifDate = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
export const adifTime = (d: Date) =>
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

/** One ADIF record, terminated by <eor>. */
export const buildAdif = (q: Qso): string => {
  const { mode, submode } = adifMode(q.rigMode);
  return [
    field("call", q.call.trim().toUpperCase()),
    // The CNTY enumeration depends on DXCC; Wavelog's JCC/JCG awards need 339.
    q.county?.trim() && isJapaneseCall(q.call) ? field("dxcc", "339") : "",
    field("qso_date", adifDate(q.date)),
    field("time_on", adifTime(q.date)),
    field("band", freqToBand(q.freqMhz)),
    field("freq", q.freqMhz.toFixed(6)),
    field("mode", mode),
    field("submode", submode),
    field("rst_sent", q.rstSent.trim()),
    field("rst_rcvd", q.rstRcvd.trim()),
    field("name", q.name?.trim()),
    field("qth", q.qth?.trim()),
    field("cnty", q.county?.trim().toUpperCase()),
    field("station_callsign", q.stationCall?.trim().toUpperCase()),
    "<eor>",
  ]
    .filter(Boolean)
    .join(" ");
};
