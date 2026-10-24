import type { LocationDto, RackSectionDto } from "@/shared/api/generated/model";

const normalized = (value: string) => value.trim().toLowerCase();

/** All existing and archived rows participate; this suggestion reserves nothing. */
export function generateLocationIdentity(
  sections: Pick<RackSectionDto, "code" | "name">[],
  locations: Pick<LocationDto, "code" | "name">[],
): { code: string; name: string } {
  const records = [...sections, ...locations];
  const codes = new Set(records.map((record) => normalized(record.code)));
  const names = new Set(records.map((record) => normalized(record.name)));
  for (let number = 1; ; number++) {
    const code = `P-${String(number).padStart(2, "0")}`;
    const name = `Место ${number}`;
    if (!codes.has(normalized(code)) && !names.has(normalized(name)))
      return { code, name };
  }
}
