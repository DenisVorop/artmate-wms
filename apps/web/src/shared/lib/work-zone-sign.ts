/** The API title starts with the zone purpose; the rest is an optional custom name. */
export function workZoneSign(title: string) {
  const archived = /^Архив\s*·\s*/iu.test(title);
  const purpose = title
    .replace(/^Архив\s*·\s*/iu, "")
    .split("·")[0]
    .trim()
    .toLocaleLowerCase("ru");
  return archived ? `${purpose} (архив)` : purpose;
}
