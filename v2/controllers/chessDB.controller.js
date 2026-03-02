// controllers/chessDB.controller.js

const { Chess } = require('chess.js'); // <--- ДОБАВЬТЕ ЭТУ СТРОКУ

// Импортируем обе модели
const Game = require('../models/Game');
const Position = require('../models/Position');

/**
 * @desc    Получить данные дебютной книги по FEN позиции
 * @route   GET /api/v2/chessdb/book/:fen
 * @access  Public
 */
const getOpeningBookByFen = async (req, res) => {
    try {
        const boardFen = req.params.fen.split(' ')[0];
        const positionData = await Position.findById(boardFen);

        if (!positionData) {
            return res.status(200).json({ success: true, data: { moves: [], total_games: 0 } });
        }
        
        const readableData = {
            fen: positionData._id,
            total_games: positionData.t,
            moves: positionData.m.map(move => ({
                san: move.s,
                games: move.g,
                wins: move.w,
                draws: move.d,
                losses: move.l,
            })).sort((a, b) => b.games - a.games),
        };
        
        res.status(200).json({ success: true, data: readableData });

    } catch (err) {
        console.error("Ошибка в контроллере getOpeningBookByFen:", err.message);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
};

/**
 * @desc    Найти партии по имени игрока
 * @route   GET /api/v2/chessdb/player/:name
 * @access  Public
 */
const getPlayerGames = async (req, res) => {
    try {
        const playerName = req.params.name;
        const playerRegex = new RegExp(playerName, 'i');
        
        const games = await Game.find({
            $or: [
                { "white": playerRegex },
                { "black": playerRegex }
            ]
        })
        .limit(100)
        .sort({ _id: -1 });

        res.status(200).json({ success: true, data: games });
    } catch (err) {
        console.error("Ошибка в контроллере getPlayerGames:", err.message);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
};

/**
 * @desc    Найти партии, в которых встретилась указанная позиция
 * @route   GET /api/v2/chessdb/games/:fen
 * @access  Public
 */
const getGamesByPgnHistory = async (req, res) => {
    try {
        const { pgn } = req.body;

        // Если пришел пустой PGN или его нет, возвращаем пустой массив
        if (!pgn || pgn.trim() === '') {
            return res.status(200).json({ success: true, data: [] });
        }

        // Убираем из PGN возможные заголовки и результат для чистоты поиска
        const cleanPgn = pgn
            .replace(/\[.*?\]\s*/g, '') // Удалить PGN теги [Event "..."]
            .replace(/(\s*(1-0|0-1|1\/2-1\/2)\s*)$/, '') // Удалить результат в конце
            .trim();
        
        if (cleanPgn === '') {
            return res.status(200).json({ success: true, data: [] });
        }

        const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(escapeRegex(cleanPgn), 'i');

        console.log(`ИЩЕМ ПАРТИИ С PGN: "${cleanPgn}"`);
        
        const games = await Game.find({ an: { $regex: searchRegex } })
                               .limit(100)
                               .select('white black result an');

        console.log(`НАЙДЕНО: ${games.length}`);

        res.status(200).json({ success: true, data: games });

    } catch (err) {
        console.error("Ошибка в контроллере getGamesByPgnHistory:", err.message);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
};
module.exports = {
    getOpeningBookByFen,
    getPlayerGames,
    getGamesByPgnHistory,
};