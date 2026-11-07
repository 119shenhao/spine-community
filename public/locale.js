// Keep browser language stable across Google OAuth redirects and page reloads.
// Selection in the language menu is stored under the same key.
export function initialLocale(storage,browserLanguage,languages){
 const saved=storage.getItem('sc_locale');
 if(languages.includes(saved))return saved;
 const browser=String(browserLanguage||'').toLowerCase();
 const chosen=browser.startsWith('zh')&&languages.includes('zh-CN')?'zh-CN'
  :browser.startsWith('pt')&&languages.includes('pt-BR')?'pt-BR'
  :languages.find(language=>browser.startsWith(language.toLowerCase()))
   ||(languages.includes('en')?'en':languages[0]);
 storage.setItem('sc_locale',chosen);
 return chosen;
}
