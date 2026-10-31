// v2/controllers/coach.controller.js

const coachRepo = require('../repositories/coach.repo'); // шов coaching (mongo|pg по COACHING_DB)
const userRepo = require('../repositories/user.repo'); // шов identity (mongo|pg по USER_DB)
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

    const updatedProfile = await coachRepo.upsertByUser(userId, { set: coachProfileFields, club: req.club });

    res.json(updatedProfile);
};


/**
 * @desc    Получить СВОЙ профиль тренера (со всеми языками для редактирования).
 * @route   GET /api/v2/coaches/me
 * @access  Private (role: COACH)
 */
const getMyCoachProfile = async (req, res) => {
    const coachProfile = await coachRepo.findByUserWithUser(req.user.id);

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
    const { uuid, page = 1, limit = 10, q } = req.query;
    const lang = req.language || 'en';

    // Изоляция по клубу (#7): каталог ограничиваем клубом ТОЛЬКО если активный клуб определён
    const filter = { isVerified: true, ...(req.club ? { clubId: req.club } : {}) };
    if (uuid) {
        const user = await userRepo.findByUuid(uuid);
        if (!user) return res.json(null);
        filter.userIds = [user._id];
    } else if (q && q.trim()) {
        // Поиск по имени: «anna», «anna kow», «kowalska» (экранирование/regex — в шве)
        const words = q.trim().split(/\s+/).slice(0, 3);
        const users = await userRepo.findByNameWords(words, { limit: 200 });
        filter.userIds = users.map((u) => u._id);
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    // Джойн user и исключение payoutInfo + сортировка по platformRating.average — в шве (app-level).
    const coachesFromDB = await coachRepo.findCatalog(filter, { skip, limit: parseInt(limit, 10) });

    const localizedCoaches = coachesFromDB.map(coachObject => {
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

    const totalCoaches = await coachRepo.countCatalog(filter);
    
    res.json({
        data: localizedCoaches,
        pagination: {
            currentPage: parseInt(page, 10),
            totalPages: Math.ceil(totalCoaches / parseInt(limit, 10)),
            totalCoaches
        }
    });
};


/**
 * @desc    Получить тренеров (пользователей) по списку email.
 *          Используется на главной (блок тренеров) — подбирает карточки по заранее заданным email.
 * @route   POST /api/v2/auth/coaches-by-email
 * @access  Public
 */
const getCoachesByEmail = async (req, res) => {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ msg: 'Invalid email list' });
    }

    const users = await userRepo.findByEmailList(emails);

    const formatted = users.map(user => ({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        roles: user.roles,
        photoUrl: user.avatarUrl || null,
    }));

    res.json(formatted);
};


/**
 * @desc    Верифицировать СВОЙ профиль тренера. Для админа: он может подтвердить себя сам
 *          (не завязано на uuid — по req.user.id), после чего профиль виден в каталоге.
 * @route   PATCH /api/v2/coaches/me/verify
 * @access  Private (role: ADMIN)
 */
const verifyMyCoachProfile = async (req, res) => {
    const coachProfile = await coachRepo.setVerifiedByUser(req.user.id);
    if (!coachProfile) {
        return res.status(404).json({ msg: 'Coach profile not found. Create it first.', code: 'COACH_PROFILE_REQUIRED' });
    }
    res.json(coachProfile);
};


module.exports = {
    upsertMyCoachProfile,
    getMyCoachProfile,
    verifyMyCoachProfile,
    getCoaches,
    getCoachesByEmail,
};