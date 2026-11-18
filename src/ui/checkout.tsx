import React from "react";
import { en, fi } from "./i18n";

export type CheckoutOrder = {
  historyId: string;
  placed: boolean;
  busy: boolean;
  open: () => void;
};

export function CheckoutButton({
  order,
  language,
}: {
  order: CheckoutOrder;
  language: string;
}) {
  const labels = language === "fi" ? fi : en;
  return (
    <button type="button" disabled={order.busy} onClick={order.open}>
      {order.placed ? labels.viewPlacedOrder : labels.ordered}
    </button>
  );
}
