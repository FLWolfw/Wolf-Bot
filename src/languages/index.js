import es from './es.js';
import en from './en.js';

const languages = {

  es,
  en

};

export function t(
  language,
  path
) {

  const lang =
    languages[language] ||
    languages.es;

  return path
    .split('.')
    .reduce(

      (obj, key) =>

        obj?.[key],

      lang

    ) || path;
}

export default languages;