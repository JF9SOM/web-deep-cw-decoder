import type { ReactNode } from "react";
import { useCwTransmit } from "../hooks/useCwTransmit";
import { TxContext } from "./txContext";

/** Owns the single CW transmit state shared by the macro panel and the log row. */
export const TxProvider = ({ children }: { children: ReactNode }) => {
  const tx = useCwTransmit();
  return <TxContext.Provider value={tx}>{children}</TxContext.Provider>;
};
