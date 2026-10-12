import { hostileFixtures } from "./hostile";
import { kGroupFixtures } from "./k-group";
import { sGroupFixtures } from "./s-group";
import { tripFixtures } from "./trips";
import type { ReceiptFixture } from "./author";

export * from "./author";
/** Every sanitized receipt fixture, each with the expectation written beside its text. */
export const receiptFixtures: ReceiptFixture[] = [
  ...sGroupFixtures,
  ...kGroupFixtures,
  ...hostileFixtures,
  ...tripFixtures,
];
