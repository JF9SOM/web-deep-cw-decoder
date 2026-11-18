import { createContext, useContext } from "react";
import type { useCwTransmit } from "../hooks/useCwTransmit";

export type TxState = ReturnType<typeof useCwTransmit>;

export const TxContext = createContext<TxState | null>(null);

/** Shared CW transmit state (calls, RST, bridge URL, macros...). */
export const useTx = (): TxState => {
  const tx = useContext(TxContext);
  if (!tx) throw new Error("useTx must be used inside <TxProvider>");
  return tx;
};
