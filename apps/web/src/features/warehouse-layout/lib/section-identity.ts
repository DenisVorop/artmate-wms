import type { LocationDto, RackSectionDto } from "@/shared/api/generated/model";

const normalized = (value: string) => value.trim().toLowerCase();

/** Suggestion only: callers pass all rows, including archived ones; API checks races. */
export function generateSectionIdentity(
  sections: Pick<RackSectionDto, "code" | "name">[],
  locations: Pick<LocationDto, "code">[],
): { code: string; name: string } {
  const sectionCodes = new Set(
    sections.map((section) => normalized(section.code)),
  );
  const sectionNames = new Set(
    sections.map((section) => normalized(section.name)),
  );
  const locationCodes = new Set(
    locations.map((location) => normalized(location.code)),
  );
  for (let number = 1; ; number++) {
    const code = `R-${String(number).padStart(2, "0")}`;
    const name = `Секция ${number}`;
    const base = normalized(code);
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
