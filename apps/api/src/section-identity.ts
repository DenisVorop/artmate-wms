import type { LocationDto, RackSectionDto } from "./dto";
const normalized = (value: string) => value.trim().toLowerCase();
/** Must match the client suggestion; the server runs this under the command's SQL lock. */
export function generateSectionIdentity(
  sections: Pick<RackSectionDto, "code" | "name">[],
  locations: Pick<LocationDto, "code">[],
) {
  const sectionCodes = new Set(sections.map((s) => normalized(s.code))),
    sectionNames = new Set(sections.map((s) => normalized(s.name))),
    locationCodes = new Set(locations.map((l) => normalized(l.code)));
  for (let number = 1; ; number++) {
    const code = `R-${String(number).padStart(2, "0")}`,
      name = `Секция ${number}`,
      base = normalized(code);
    if (
      sectionCodes.has(base) ||
      locationCodes.has(base) ||
      sectionNames.has(normalized(name))
    )
      continue;
    let childConflict = false;
    for (let level = 1; level <= 20; level++) {
      const child = `${base}-${String(level).padStart(2, "0")}`;
      if (locationCodes.has(child) || sectionCodes.has(child)) {
        childConflict = true;
        break;
      }
    }
    if (!childConflict) return { code, name };
  }
}
