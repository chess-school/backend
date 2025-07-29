const deepl = require('deepl-node');

const authKey = process.env.DEEPL_AUTH_KEY;
if (!authKey) {
    console.error("CRITICAL: DEEPL_AUTH_KEY is not set. Translation service is disabled.");
}
const translator = authKey ? new deepl.Translator(authKey) : null;

/**
 * Переводит текст на целевые языки ОДИН ЗА ДРУГИМ.
 * Это медленнее, но надежнее для отладки.
 */
async function translateText(text, targetLangs, sourceLang) {
    if (!translator || !text || !targetLangs || targetLangs.length === 0 || !sourceLang) {
        return {};
    }

    const translations = {};
    for (const lang of targetLangs) {
        try {
            console.log(`--- Translating text to '${lang}'... ---`);
            const result = await translator.translateText(
                text,
                sourceLang.toUpperCase(),
                lang.toUpperCase() 
            );
            translations[lang] = result.text;
        } catch (error) {
            console.error(`DeepL Error translating to '${lang}':`, error.message);
        }
    }
    return translations;
}

/**
 * Переводит массив строк, также один язык за раз.
 */
async function translateArray(texts, targetLangs, sourceLang) {
    if (!translator || !texts || texts.length === 0 || !targetLangs || targetLangs.length === 0 || !sourceLang) {
        return {};
    }
    
    const translations = {};
    for (const lang of targetLangs) {
        try {
             console.log(`--- Translating array to '${lang}'... ---`);
            const results = await translator.translateText(
                texts,
                sourceLang.toUpperCase(),
                lang.toUpperCase()
            );
            translations[lang] = results.map(r => r.text);
        } catch (error) {
            console.error(`DeepL Error translating array to '${lang}':`, error.message);
        }
    }
    return translations;
}

module.exports = {
    translateText,
    translateArray
};