export type RichMenuLayoutType = 'TALL' | 'COMPACT';

export const LEGACY_RICH_MENU_WIDTH = 2500;
export const LEGACY_RICH_MENU_HEIGHT = 1686;
export const COMPACT_RICH_MENU_HEIGHT = 843;
export const MAX_RICH_MENU_AREAS = 20;

const integer = (value: unknown) => Math.round(Number(value));

export function resolveRichMenuDimensions(width: unknown, height: unknown) {
  const resolvedWidth = integer(width);
  const resolvedHeight = integer(height);
  return {
    width: Number.isFinite(resolvedWidth) && resolvedWidth > 0 ? resolvedWidth : LEGACY_RICH_MENU_WIDTH,
    height: Number.isFinite(resolvedHeight) && resolvedHeight > 0 ? resolvedHeight : LEGACY_RICH_MENU_HEIGHT,
  };
}

export function classifyRichMenuLayout(width: number, height: number): RichMenuLayoutType {
  const ratio = width / height;
  const tallRatio = LEGACY_RICH_MENU_WIDTH / LEGACY_RICH_MENU_HEIGHT;
  const compactRatio = LEGACY_RICH_MENU_WIDTH / COMPACT_RICH_MENU_HEIGHT;
  return Math.abs(ratio - compactRatio) < Math.abs(ratio - tallRatio) ? 'COMPACT' : 'TALL';
}

export function validateRichMenuImageDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 800 || width > 2500 || height < 250 || width / height < 1.45) {
    throw new Error('RICH_MENU_IMAGE_DIMENSIONS_INVALID');
  }
  return { width, height, layoutType: classifyRichMenuLayout(width, height) };
}

export function richMenuAreaStyle(area: Record<string, unknown>, width: number, height: number) {
  return {
    left: `${(Number(area.x) / width) * 100}%`,
    top: `${(Number(area.y) / height) * 100}%`,
    width: `${(Number(area.width) / width) * 100}%`,
    height: `${(Number(area.height) / height) * 100}%`,
  };
}

export function normalizeDetectedRichMenuAreas(areas: unknown[], width: number, height: number) {
  return areas.slice(0, MAX_RICH_MENU_AREAS).map((value, index) => {
    const area = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const x = Math.min(width - 1, Math.max(0, integer(area.x) || 0));
    const y = Math.min(height - 1, Math.max(0, integer(area.y) || 0));
    const areaWidth = Math.min(width - x, Math.max(1, integer(area.width) || 1));
    const areaHeight = Math.min(height - y, Math.max(1, integer(area.height) || 1));
    const normalized = {
      id: Number.isFinite(Number(area.id)) ? Number(area.id) : index + 1,
      label: String(area.label || `區塊 ${index + 1}`).trim() || `區塊 ${index + 1}`,
      x,
      y,
      width: areaWidth,
      height: areaHeight,
    };
    return { ...normalized, style: richMenuAreaStyle(normalized, width, height) };
  });
}

export function validateRichMenuAreas(areas: unknown[], width: number, height: number) {
  if (!Array.isArray(areas) || areas.length < 1 || areas.length > MAX_RICH_MENU_AREAS) {
    throw new Error('RICH_MENU_AREA_COUNT_INVALID');
  }
  return areas.map((value, index) => {
    const area = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const x = integer(area.x);
    const y = integer(area.y);
    const areaWidth = integer(area.width);
    const areaHeight = integer(area.height);
    if (![x, y, areaWidth, areaHeight].every(Number.isInteger)
      || x < 0 || y < 0 || areaWidth < 1 || areaHeight < 1
      || x + areaWidth > width || y + areaHeight > height) {
      throw new Error(`RICH_MENU_AREA_OUT_OF_BOUNDS:${index + 1}`);
    }
    return { ...area, x, y, width: areaWidth, height: areaHeight };
  });
}

const uint24le = (bytes: Uint8Array, offset: number) => (
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
);

export function readImageDimensions(buffer: ArrayBuffer, mimeType: string) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (mimeType === 'image/png' && bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (mimeType === 'image/jpeg' && bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (sofMarkers.has(marker)) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      offset += 2 + length;
    }
  }

  if (mimeType === 'image/webp' && bytes.length >= 30
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X') return { width: uint24le(bytes, 24) + 1, height: uint24le(bytes, 27) + 1 };
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      };
    }
  }

  throw new Error('RICH_MENU_IMAGE_DIMENSIONS_UNREADABLE');
}
