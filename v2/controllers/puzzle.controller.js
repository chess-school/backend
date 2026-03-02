// Импортируем модель, чтобы контроллер мог работать с базой данных
const Puzzle = require('../models/Puzzle');

// @desc    Получить случайную задачу, с возможностью фильтрации по рейтингу
// @route   GET /api/puzzles/random
// @access  Public
const getRandomPuzzle = async (req, res) => {
    try {
        const { minRating, maxRating } = req.query;

        // 1. Создаем объект фильтра для MongoDB
        const filter = {};
        if (minRating && maxRating) {
            // Убедимся, что параметры являются числами
            const min = parseInt(minRating);
            const max = parseInt(maxRating);
            if (!isNaN(min) && !isNaN(max)) {
                filter.rating = { $gte: min, $lte: max };
            }
        }

        // 2. Считаем количество документов, подходящих под фильтр
        const count = await Puzzle.countDocuments(filter);

        if (count === 0) {
            return res.status(404).json({ success: false, message: 'Задачи с указанными параметрами не найдены' });
        }

        // 3. Генерируем случайный индекс для выборки
        const random = Math.floor(Math.random() * count);

        // 4. Находим одну случайную задачу, используя .skip() для эффективности
        const puzzle = await Puzzle.findOne(filter).skip(random);

        res.status(200).json({ success: true, data: puzzle });

    } catch (err) {
        console.error("Ошибка в контроллере getRandomPuzzle:", err.message);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
};

// Экспортируем нашу функцию, чтобы ее можно было использовать в файле маршрутов
module.exports = {
    getRandomPuzzle,
};