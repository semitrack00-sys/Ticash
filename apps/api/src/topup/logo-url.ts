// Display metadata only. Never fetch logos on the server or derive carrier URLs.
export function providerLogoUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^https:\/\/[^/\\?#]/i.test(value) ||
      /[\s\\]/u.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || /%(?![0-9a-f]{2})/i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return undefined;
    return value;
  } catch { return undefined; }
}
