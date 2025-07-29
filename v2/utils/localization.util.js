const SUPPORTED_LANGS = ['en', 'uk', 'pl'];
const FALLBACK_LANG = 'en';

/**
 * Принимает многоязычный объект и язык, возвращает локализованное значение.
 * @param {object} localizedObject - Объект вида { en: '..', uk: '..', pl: '..' }
 * @param {string} lang - Запрошенный язык (напр., 'uk')
 * @returns {any} - Значение на запрошенном языке или на языке по умолчанию.
 */
function localize(localizedObject, lang) {
    if (!localizedObject || typeof localizedObject !== 'object') {
        return localizedObject; // Возвращаем как есть, если это не объект для локализации
    }
    // Проверяем, есть ли значение для запрошенного языка.
    if (localizedObject[lang] !== undefined) {
        return localizedObject[lang];
    }
    // Если нет, возвращаем значение для языка по умолчанию.
    if (localizedObject[FALLBACK_LANG] !== undefined) {
        return localizedObject[FALLBACK_LANG];
    }
    // Если нет и языка по умолчанию, возвращаем первое доступное значение.
    for (const key of SUPPORTED_LANGS) {
        if (localizedObject[key] !== undefined) {
            return localizedObject[key];
        }
    }
    return null; // Или возвращаем пустую строку/массив в зависимости от контекста
}


/**
 * Универсальная функция для преобразования документа из БД в локализованный DTO.
 * @param {object} document - Mongoose-документ (преобразованный в .toObject()).
 * @param {string} lang - Целевой язык.
 * @param {Array<string>} fieldsToLocalize - Массив имен полей, которые нужно локализовать.
 * @param {Array<string>} fieldsToKeep - Массив имен полей, которые нужно оставить "как есть".
 * @returns {object} - Новый, локализованный объект.
 */
function createLocalizedDTO(document, lang, fieldsToLocalize = [], fieldsToKeep = []) {
    if (!document) return null;

    const dto = {};

    // 1. Локализуем указанные поля
    for (const field of fieldsToLocalize) {
        dto[field] = localize(document[field], lang);
    }

    // 2. Копируем указанные "простые" поля
    for (const field of fieldsToKeep) {
        if (document[field] !== undefined) {
            dto[field] = document[field];
        }
    }

    return dto;
}


module.exports = {
    localize,
    createLocalizedDTO
};