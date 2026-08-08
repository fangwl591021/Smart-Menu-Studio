export const GUIDE_REFRESH_EVENT = 'smart-menu:guide-refresh';

export function emitGuideEvent(detail) {
  if (import.meta.env.DEV) console.debug('[Smart Guide]', detail);
  if (detail?.type === 'guide-refresh') {
    window.dispatchEvent(new CustomEvent(GUIDE_REFRESH_EVENT, { detail }));
  }
}
