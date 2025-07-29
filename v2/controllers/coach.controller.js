// v2/controllers/coach.controller.js

const Coach = require('../models/Coach');
const User = require('../models/User');
const translateService = require('../services/translate.service');
const { createLocalizedDTO } = require('../utils/localization.util'); // <-- НАША НОВАЯ УТИЛИТА

const SUPPORTED_LANGS = ['en', 'uk', 'pl'];


// =================================================================
//                      ДЛЯ АУТЕНТИФИЦИРОВАННЫХ ТРЕНЕРОВ (/coaches/me)
// =================================================================

/**
 * @desc    Создать или обновить СВОЙ профиль тренера.
 *          Принимает данные на одном языке и автоматически переводит на остальные.
 * @route   PUT /api/v2/coaches/me
 * @access  Private (role: COACH)
 */
const upsertMyCoachProfile = async (req, res) => {
    const { headline, bio, specializations, fideProfile, sourceLang } = req.body;
    const userId = req.user.id;

    const finalSourceLang = (sourceLang && SUPPORTED_LANGS.includes(sourceLang)) ? sourceLang : 'en';
    const targetLangs = SUPPORTED_LANGS.filter(lang => lang !== finalSourceLang);
    
    console.log(`Upserting profile for user ${userId}. Source lang: ${finalSourceLang}, target: ${targetLangs.join(', ')}`);

    const coachProfileFields = {};
    if (fideProfile) coachProfileFields.fideProfile = fideProfile;

    try {
        if (headline) {
            coachProfileFields.headline = { [finalSourceLang]: headline };
            if (targetLangs.length > 0) {
                const translations = await translateService.translateText(headline, targetLangs, finalSourceLang);
                Object.assign(coachProfileFields.headline, translations);
            }
        }

        if (bio) {
            coachProfileFields.bio = { [finalSourceLang]: bio };
            if (targetLangs.length > 0) {
                const translations = await translateService.translateText(bio, targetLangs, finalSourceLang);
                Object.assign(coachProfileFields.bio, translations);
            }
        }

        if (specializations && Array.isArray(specializations) && specializations.length > 0) {
            coachProfileFields.specializations = { [finalSourceLang]: specializations };
            if (targetLangs.length > 0) {
                const translations = await translateService.translateArray(specializations, targetLangs, finalSourceLang);
                Object.keys(translations).forEach(lang => {
                    coachProfileFields.specializations[lang] = translations[lang];
                });
            }
        }
    } catch (error) {
        console.error("Auto-translation process failed:", error);
    }

    const updatedProfile = await Coach.findOneAndUpdate(
        { user: userId },
        { $set: coachProfileFields },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    
    res.json(updatedProfile);
};


/**
 * @desc    Получить СВОЙ профиль тренера (со всеми языками для редактирования).
 * @route   GET /api/v2/coaches/me
 * @access  Private (role: COACH)
 */
const getMyCoachProfile = async (req, res) => {
    const coachProfile = await Coach.findOne({ user: req.user.id })
        .populate('user', ['firstName', 'lastName', 'uuid', 'avatarUrl']);
    
    if (!coachProfile) {
        return res.status(404).json({ msg: 'Coach profile not found for this user. Please create one first.' });
    }
    
    res.json(coachProfile);
};


// =================================================================
//                      ДЛЯ ПУБЛИЧНОГО ПРОСМОТРА (/coaches)
// =================================================================

/**
 * @desc    Получить локализованный список тренеров или одного тренера по UUID.
 * @route   GET /api/v2/coaches
 * @access  Public
 */
const getCoaches = async (req, res) => {
    const { uuid, page = 1, limit = 10 } = req.query;
    const lang = req.language || 'en';

    const query = { isVerified: true };
    if (uuid) {
        const user = await User.findOne({ uuid }).select('_id');
        if (!user) return res.json(uuid ? null : { data: [] });
        query.user = user._id;
    }
    
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    
    const coachesFromDB = await Coach.find(query)
        .populate('user', ['uuid', 'firstName', 'lastName', 'avatarUrl'])
        .select('-payoutInfo -__v') 
        .sort({ 'platformRating.average': -1 })
        .skip(skip)
        .limit(parseInt(limit, 10));

    const localizedCoaches = coachesFromDB.map(coach => {
        const coachObject = coach.toObject();
        
        const localizedProfile = createLocalizedDTO(
            coachObject,
            lang,
            ['headline', 'bio', 'specializations'], 
            ['fideProfile', 'platformRating']   
        );
        
        localizedProfile.user = coachObject.user;
        
        return localizedProfile;
    });
    
    if (uuid) {
        return res.json(localizedCoaches[0] || null);
    }
    
    const totalCoaches = await Coach.countDocuments(query);
    
    res.json({
        data: localizedCoaches,
        pagination: {
            currentPage: parseInt(page, 10),
            totalPages: Math.ceil(totalCoaches / parseInt(limit, 10)),
            totalCoaches
        }
    });
};


module.exports = {
    upsertMyCoachProfile,
    getMyCoachProfile,
    getCoaches,
};