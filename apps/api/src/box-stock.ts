export function isBoxOnHand(status: string): boolean {
  return status === "stored" || status === "in_transit" || status === "staged";
}
