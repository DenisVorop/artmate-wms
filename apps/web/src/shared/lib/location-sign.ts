/** Printed captions only: existing names carry the physical rack's place number.
 * Never derive it modulo 2/3: racks can have different numbers of pallet columns.
 * Unknown names keep the full address instead of inventing a place or level.
 */
export function locationSign(label: { code: string; title: string }) {
  const place = /(?:^|[·,;])\s*место\s+(\d+)\s*(?=[·,;]|$)/iu.exec(label.title);
  const tier = /(?:^|[·,;])\s*ярус\s+(\d+)\s*(?=[·,;]|$)/iu.exec(label.title);
  return {
    place: place ? String(Number(place[1])) : label.code,
    tier: tier ? String(Number(tier[1])) : null,
    archived: /^Архив\s*·/iu.test(label.title),
  };
}
