// Match the order itself: supplier fulfilment orders are not in the customer-order grouping.
export function matchesFleetSelection(order: { vessel: string; vesselImo?: string | null }, selectedName: string, registered?: { name: string; imo: string | null }) {
  if (selectedName === "all") return true;
  if (registered?.imo && order.vesselImo) return registered.imo === order.vesselImo;
  return order.vessel.toLocaleLowerCase("en-US") === selectedName.toLocaleLowerCase("en-US");
}
