import { useEffect, useState } from "react";
import { Badge, Box, Button, Flex, Text, TextInput } from "@mantine/core";
import { buildAdif, isJapaneseCall, isJccJcgNumber } from "./log/adif";
import { readRigStatus, useRigStatus } from "./hooks/useRigStatus";
import { useTx } from "./tx/txContext";

// "MM-DD HH:MMZ" for display only; the ADIF record carries the full date.
const DEFAULT_MY_RST = "599";

const utcNow = () => new Date().toISOString().slice(5, 16).replace("T", " ") + "Z";

type Notice = { ok: boolean; text: string } | null;

/** One-line QSO log entry; sends an ADIF record to the logger via the bridge. */
export const LogPanel = () => {
  const tx = useTx();
  const { status } = useRigStatus(tx.bridgeUrl);
  const [clock, setClock] = useState(utcNow());
  const [myRst, setMyRst] = useState(DEFAULT_MY_RST);
  const [name, setName] = useState("");
  const [qth, setQth] = useState("");
  const [county, setCounty] = useState("");
  const [manualFreq, setManualFreq] = useState("");
  const [manualMode, setManualMode] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setClock(utcNow()), 1000);
    return () => clearInterval(id);
  }, []);

  const log = async () => {
    const call = tx.hisCall.trim();
    if (!call) {
      setNotice({ ok: false, text: "Enter HIS CALL first." });
      return;
    }
    if (county.trim() && isJapaneseCall(call) && !isJccJcgNumber(county)) {
      setNotice({ ok: false, text: "COUNTY must be a JCC/JCG number (4-6 digits)." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      // Read the rig again right now so the record has the frequency/mode at LOG time.
      let freqMhz: number;
      let rigMode: string;
      try {
        const s = await readRigStatus(tx.bridgeUrl);
        freqMhz = s.freqMhz;
        rigMode = s.mode;
      } catch {
        freqMhz = Number(manualFreq);
        rigMode = manualMode.trim();
        if (!Number.isFinite(freqMhz) || freqMhz <= 0 || !rigMode) {
          setNotice({
            ok: false,
            text: "No rig reading: enter FREQ (MHz) and MODE, or start rigctld and the bridge.",
          });
          return;
        }
      }
      const record = buildAdif({
        call,
        date: new Date(),
        freqMhz,
        rigMode,
        rstSent: tx.rst,
        rstRcvd: myRst,
        name,
        qth,
        county,
        stationCall: tx.myCall,
      });
      const res = await fetch(`${tx.bridgeUrl.replace(/\/$/, "")}/adif`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: record,
      });
      if (!res.ok) {
        const why =
          res.status === 503
            ? "ADIF forwarding is off in ctld-launcher (set the ADIF UDP port)."
            : `Bridge error: HTTP ${res.status} ${(await res.text()).trim()}`;
        setNotice({ ok: false, text: why });
        return;
      }
      setNotice({ ok: true, text: `Logged ${call.toUpperCase()}` });
      setMyRst(DEFAULT_MY_RST);
      setName("");
      setQth("");
      setCounty("");
    } catch (e) {
      setNotice({
        ok: false,
        text: `Could not reach the bridge (${e instanceof Error ? e.message : String(e)}).`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box data-no-fkey>
      <Flex gap={4} align="flex-end" wrap="wrap" px={8}>
        <TextInput label="UTC" value={clock} readOnly w={100} size="xs" />
        {status ? (
          <TextInput
            label="FREQ / MODE"
            value={`${status.freqMhz.toFixed(3)} ${status.mode}`}
            readOnly
            w={100}
            size="xs"
          />
        ) : (
          <>
            <TextInput
              label="FREQ (MHz)"
              placeholder="7.030"
              value={manualFreq}
              onChange={(e) => setManualFreq(e.currentTarget.value)}
              w={80}
              size="xs"
            />
            <TextInput
              label="MODE"
              placeholder="CW"
              value={manualMode}
              onChange={(e) => setManualMode(e.currentTarget.value.toUpperCase())}
              w={60}
              size="xs"
            />
          </>
        )}
        <TextInput label="HIS CALL" value={tx.hisCall.toUpperCase()} readOnly w={72} size="xs" />
        <TextInput label="HIS RST" value={tx.rst} readOnly w={58} size="xs" />
        <TextInput
          label="MY RST"
          value={myRst}
          onChange={(e) => setMyRst(e.currentTarget.value)}
          w={54}
          size="xs"
        />
        <TextInput
          label="NAME"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          w={66}
          size="xs"
        />
        <TextInput
          label="QTH"
          value={qth}
          onChange={(e) => setQth(e.currentTarget.value)}
          w={76}
          size="xs"
        />
        <TextInput
          label="COUNTY"
          placeholder="JCC/JCG"
          value={county}
          onChange={(e) => setCounty(e.currentTarget.value)}
          w={72}
          size="xs"
        />
        <Button size="xs" px={10} onClick={() => void log()} loading={busy}>
          LOG
        </Button>
        {!status && (
          <Badge color="gray" variant="light" size="sm" mb={4}>
            rig offline
          </Badge>
        )}
      </Flex>
      {notice && (
        <Text size="xs" c={notice.ok ? "teal" : "red"} px={8} pt={4}>
          {notice.text}
        </Text>
      )}
    </Box>
  );
};
