// Browser-only display preferences. They never alter posted content or server data.
export const defaultReadingPreferences = Object.freeze({theme:'standard',size:'regular'});
const themes = new Set(['standard','warm']);
const sizes = new Set(['regular','comfortable','large']);

export function normalizeReadingPreferences(input = {}) {
  return {
    theme: themes.has(input.theme) ? input.theme : defaultReadingPreferences.theme,
    size: sizes.has(input.size) ? input.size : defaultReadingPreferences.size
  };
}
export function loadReadingPreferences(storage) {
  try {
    return normalizeReadingPreferences(JSON.parse(storage?.getItem('sc_reading_preferences') || '{}'));
  } catch {
    return {...defaultReadingPreferences};
  }
}
export function applyReadingPreferences(root, preferences) {
  const safe = normalizeReadingPreferences(preferences);
  root.dataset.readingTheme = safe.theme;
  root.dataset.readingSize = safe.size;
  return safe;
}
export function saveReadingPreferences(storage, root, preferences) {
  const safe = applyReadingPreferences(root, preferences);
  try {
    storage?.setItem('sc_reading_preferences', JSON.stringify(safe));
  } catch {
    // Retain the current-page choice when storage is unavailable.
  }
  return safe;
}
const labels = {
  en: {link:'Reading settings',title:'Reading comfort',hint:'Adjust the appearance for easier reading. The warm palette is optional, not a medical treatment.',theme:'Page colors',standard:'Clear light',warm:'Soft warm',size:'Text size',regular:'Standard',comfortable:'Larger',large:'Largest',reset:'Restore defaults'},
  'zh-CN': {link:'阅读设置',title:'舒适阅读',hint:'调整页面配色和字号，方便长时间阅读。柔和暖色仅是视觉偏好，并非医疗护眼措施。',theme:'页面配色',standard:'清晰浅色',warm:'柔和暖色',size:'文字大小',regular:'标准',comfortable:'较大',large:'最大',reset:'恢复默认'},
  'zh-TW': {link:'閱讀設定',title:'舒適閱讀',hint:'調整頁面配色與字級，方便長時間閱讀。柔和暖色僅是視覺偏好，並非醫療護眼措施。',theme:'頁面配色',standard:'清晰淺色',warm:'柔和暖色',size:'文字大小',regular:'標準',comfortable:'較大',large:'最大',reset:'恢復預設'},
  es: {link:'Ajustes de lectura',title:'Lectura cómoda',hint:'Ajusta colores y tamaño del texto. El tono cálido es una preferencia visual, no un tratamiento médico.',theme:'Colores',standard:'Claro',warm:'Cálido suave',size:'Tamaño del texto',regular:'Normal',comfortable:'Más grande',large:'Máximo',reset:'Restablecer'},
  'pt-BR': {link:'Configurações de leitura',title:'Leitura confortável',hint:'Ajuste as cores e o tamanho do texto. O tom quente é uma preferência visual, não um tratamento médico.',theme:'Cores da página',standard:'Claro',warm:'Quente suave',size:'Tamanho do texto',regular:'Padrão',comfortable:'Maior',large:'Máximo',reset:'Restaurar'},
  de: {link:'Leseeinstellungen',title:'Angenehm lesen',hint:'Farben und Schriftgröße anpassen. Warme Farben sind eine persönliche Vorliebe, keine medizinische Maßnahme.',theme:'Seitenfarben',standard:'Hell',warm:'Sanft warm',size:'Schriftgröße',regular:'Standard',comfortable:'Größer',large:'Am größten',reset:'Zurücksetzen'},
  fr: {link:'Paramètres de lecture',title:'Lecture confortable',hint:'Réglez les couleurs et la taille du texte. Le thème chaud est un choix visuel, pas un traitement médical.',theme:'Couleurs',standard:'Clair',warm:'Doux et chaud',size:'Taille du texte',regular:'Normale',comfortable:'Plus grande',large:'Maximale',reset:'Réinitialiser'},
  ja: {link:'読みやすさの設定',title:'読みやすさ',hint:'画面の色と文字サイズを調整できます。暖色表示は好みの設定であり、医学的な効果を保証しません。',theme:'画面の色',standard:'明るい',warm:'やさしい暖色',size:'文字サイズ',regular:'標準',comfortable:'大きめ',large:'最大',reset:'初期設定に戻す'}
};
export const readingLabels = (locale) => labels[locale] || labels.en;
