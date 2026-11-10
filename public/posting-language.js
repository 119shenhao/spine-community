// An unset posting-language preference follows the currently selected interface language.
// A consciously selected language stays fixed even when the interface is changed.
export function postingLanguage(user,interfaceLocale,languages){
 return user?.preferred_locale_mode==='manual'&&languages.includes(user?.preferred_locale)
  ? user.preferred_locale
  : languages.includes(interfaceLocale)?interfaceLocale:'en';
}

export function profilePostingLanguageOptions(user,interfaceLocale,languages,translate,languageOptions){
 const auto=user?.preferred_locale_mode!=='manual';
 const selected=auto?'auto':user.preferred_locale;
 const current={'zh-CN':'简体中文','zh-TW':'繁體中文'}[interfaceLocale]
  ||new Intl.DisplayNames([interfaceLocale],{type:'language'}).of(interfaceLocale)||interfaceLocale;
 return '<option value="auto"'+(auto?' selected':'')+'>'+translate('followInterface')+' ('+current+')</option>'
  +languageOptions(selected,false);
}
