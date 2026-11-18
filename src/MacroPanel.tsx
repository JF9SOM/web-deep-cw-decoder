import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Collapse,
  Flex,
  NativeSelect,
  NumberInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useCwTransmit, MACRO_COUNT } from "./hooks/useCwTransmit";
import { MAX_WPM, MIN_WPM } from "./tx/morse";
import type { SerialPin, TxMethod } from "./tx/transmitters";

const METHOD_LABELS: Record<TxMethod, string> = {
  audio: "Audio (sidetone / sound card)",
  serial: "Serial DTR/RTS (Web Serial)",
  rigctld: "rigctld CAT (via bridge)",
};

export const MacroPanel = () => {
  const tx = useCwTransmit();
  const [freeText, setFreeText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (tx.method !== "audio" || !navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices.enumerateDevices().then((devices) =>
      setOutputs(devices.filter((d) => d.kind === "audiooutput")),
    );
  }, [tx.method]);

  const sending = tx.sendingText !== null;

  return (
    <Stack gap={8}>
      <Flex gap="xs" align="center" wrap="wrap">
        <Text size="sm" fw={700}>
          SEND
        </Text>
        <Badge color={sending ? "red" : "gray"} variant={sending ? "filled" : "light"}>
          {sending ? (tx.queuedCount > 0 ? `TX +${tx.queuedCount}` : "TX") : "idle"}
        </Badge>
        <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 0 }} truncate>
          {tx.sendingText ?? "F1–F12 send (queued while sending) · Esc stops all"}
        </Text>
        <Button size="compact-sm" color="red" variant="light" onClick={tx.stop} disabled={!sending}>
          Stop
        </Button>
        <Button size="compact-sm" variant="subtle" onClick={() => setShowSettings((v) => !v)}>
          Settings
        </Button>
        <Button size="compact-sm" variant="subtle" onClick={() => setShowEdit((v) => !v)}>
          Edit macros
        </Button>
      </Flex>

      {tx.error && (
        <Text size="sm" c="red.4">
          {tx.error}
        </Text>
      )}

      <Flex gap="xs" align="flex-end" wrap="wrap">
        <TextInput
          label="HIS CALL"
          placeholder="e.g. JA1ABC"
          w={150}
          value={tx.hisCall}
          onChange={(e) => tx.setHisCall(e.currentTarget.value.toUpperCase())}
        />
        <TextInput
          label="RST"
          w={70}
          value={tx.rst}
          onChange={(e) => tx.setRst(e.currentTarget.value)}
        />
        <Button
          variant="subtle"
          size="compact-sm"
          onClick={() => tx.setHisCall("")}
          disabled={!tx.hisCall}
        >
          Clear
        </Button>
      </Flex>

      <SimpleGrid cols={{ base: 3, sm: 4, md: 6 }} spacing={6}>
        {tx.macros.slice(0, MACRO_COUNT).map((m, i) => (
          <Button
            key={i}
            variant="default"
            size="compact-md"
            title={m.text}
            onClick={() => tx.send(m.text)}
            styles={{ label: { justifyContent: "flex-start" } }}
          >
            <Text span size="xs" c="dimmed" mr={6}>
              F{i + 1}
            </Text>
            {m.label || "—"}
          </Button>
        ))}
      </SimpleGrid>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          tx.send(freeText);
        }}
      >
        <Flex gap="xs">
          <TextInput
            style={{ flex: 1 }}
            placeholder="Free text (e.g. TNX FER CALL) — {MYCALL} {HISCALL} {RST} {RST-SHORT} allowed"
            value={freeText}
            onChange={(e) => setFreeText(e.currentTarget.value)}
          />
          <Button type="submit" disabled={!freeText.trim()}>
            Send
          </Button>
        </Flex>
      </form>

      <Collapse in={showSettings}>
        <Box data-no-fkey>
          <Stack gap="xs">
            <Flex gap="md" wrap="wrap">
              <NativeSelect
                label="TX METHOD"
                data={(Object.keys(METHOD_LABELS) as TxMethod[]).map((v) => ({
                  value: v,
                  label: METHOD_LABELS[v],
                }))}
                value={tx.method}
                onChange={(e) => tx.setMethod(e.currentTarget.value as TxMethod)}
              />
              <NumberInput
                label="WPM"
                w={90}
                min={MIN_WPM}
                max={MAX_WPM}
                value={tx.wpm}
                onChange={(v) => typeof v === "number" && tx.setWpm(v)}
              />
              <TextInput label="MY CALL" w={120} value={tx.myCall}
                onChange={(e) => tx.setMyCall(e.currentTarget.value.toUpperCase())} />
            </Flex>

            {tx.method === "audio" && (
              <Flex gap="md" wrap="wrap">
                <NumberInput label="TONE" w={100} min={200} max={2000} step={10}
                  rightSection="Hz" value={tx.toneHz}
                  onChange={(v) => typeof v === "number" && tx.setToneHz(v)} />
                <NumberInput label="VOLUME" w={90} min={0} max={100} step={5}
                  value={Math.round(tx.volume * 100)}
                  onChange={(v) => typeof v === "number" && tx.setVolume(v / 100)} />
                <NativeSelect
                  label="OUTPUT"
                  data={[
                    { value: "", label: "Default" },
                    ...outputs.map((d, i) => ({
                      value: d.deviceId,
                      label: d.label || `Output ${i + 1}`,
                    })),
                  ]}
                  value={tx.sinkId}
                  onChange={(e) => tx.setSinkId(e.currentTarget.value)}
                />
              </Flex>
            )}

            {tx.method === "serial" && (
              <Flex gap="md" wrap="wrap" align="flex-end">
                <NativeSelect
                  label="KEY LINE"
                  data={["DTR", "RTS"]}
                  value={tx.serialPin}
                  onChange={(e) => tx.setSerialPin(e.currentTarget.value as SerialPin)}
                />
                {tx.serialSupported ? (
                  tx.serialConnected ? (
                    <Button color="red" variant="light" onClick={() => void tx.disconnectSerial()}>
                      Disconnect port
                    </Button>
                  ) : (
                    <Button onClick={() => void tx.connectSerial()}>Select serial port…</Button>
                  )
                ) : (
                  <Text size="sm" c="red.4">
                    Web Serial is not available (use Chrome / Edge over https or localhost).
                  </Text>
                )}
                <Text size="xs" c="dimmed">
                  {tx.serialConnected ? "Port connected" : "No port"}
                </Text>
              </Flex>
            )}

            {tx.method === "rigctld" && (
              <Stack gap={4}>
                <TextInput label="BRIDGE URL" value={tx.bridgeUrl}
                  onChange={(e) => tx.setBridgeUrl(e.currentTarget.value)} />
                <Text size="xs" c="dimmed">
                  Browsers cannot reach rigctld's TCP port directly. Start the local relay:
                  <code> node tools/rigctld-bridge.mjs</code> (see README).
                </Text>
              </Stack>
            )}
          </Stack>
        </Box>
      </Collapse>

      <Collapse in={showEdit}>
        <Stack gap={4} data-no-fkey>
          {tx.macros.slice(0, MACRO_COUNT).map((m, i) => (
            <Flex key={i} gap="xs" align="center">
              <Text size="xs" w={28}>F{i + 1}</Text>
              <TextInput w={90} value={m.label} maxLength={10}
                onChange={(e) => tx.updateMacro(i, { label: e.currentTarget.value })} />
              <TextInput style={{ flex: 1 }} value={m.text}
                onChange={(e) => tx.updateMacro(i, { text: e.currentTarget.value.toUpperCase() })} />
            </Flex>
          ))}
          <Flex>
            <Button
              size="compact-sm"
              variant="light"
              color="gray"
              onClick={() => {
                if (window.confirm("Reset all 12 macros to the defaults? Your edits will be lost.")) {
                  tx.resetMacros();
                }
              }}
            >
              Reset macros to defaults
            </Button>
          </Flex>
          <Text size="xs" c="dimmed">
            Placeholders: {"{MYCALL}"} {"{HISCALL}"} {"{RST}"} {"{RST-SHORT}"} (599→5NN, 579→5BN) · prosigns: {"<AR> <SK> <BT> <KN> <AS> <BK>"}
          </Text>
        </Stack>
      </Collapse>
    </Stack>
  );
};
