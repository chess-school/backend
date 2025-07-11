const i18next = require('i18next');
const i18nextMiddleware = require('i18next-http-middleware');
const Backend = require('i18next-fs-backend');

i18next
  .use(Backend) 
  .use(i18nextMiddleware.LanguageDetector) 
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'uk', 'pl'],

    backend: {
      loadPath: 'locales/{{lng}}/translation.json',
    },

    detection: {
      order: ['header'], 
    },
  });

module.exports = i18nextMiddleware.handle(i18next);