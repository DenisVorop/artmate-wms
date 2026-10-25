/** A response from an old session must not clear the current form or show success. */
export async function submitSkuCreate(
  command: () => Promise<unknown>,
  isScopeCurrent: () => boolean,
): Promise<boolean> {
  if (!isScopeCurrent()) return false;
  try {
    await command();
    return isScopeCurrent();
  } catch (error) {
    if (isScopeCurrent()) throw error;
    return false;
  }
}
