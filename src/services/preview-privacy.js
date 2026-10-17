export const PREVIEW_ASKING_STORAGE_KEY = 'love-map-preview-asking-v1';
export const PREVIEW_DASHBOARD_STORAGE_KEY = 'love-map-preview-dashboard-v1';

export function previewText(value, preview = false) {
  if (!preview || typeof value !== 'string') return value;
  return value.replace(/여진|yeojin/gi, '여보').replace(/민재|minjae/gi, '자기');
}

export const relationshipDay = (realDay, preview = false) => preview ? 1 : realDay;

export function displayIdentityText(value, preview = false, names = {}) {
  if (preview) return previewText(value, true);
  const slot = value === 'YEOJIN' ? '여진' : value === 'MINJAE' ? '민재' : value;
  return typeof slot === 'string' && Object.prototype.hasOwnProperty.call(names, slot) ? names[slot] : value;
}
