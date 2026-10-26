const GameModel = require('../models/Game');
const PlayerModel = require('../models/Player');

class GameController {
  // Получение списка активных вызовов
  async getChallenges(req, res) {
    try {
      const challenges = await GameModel.find({ status: 'waiting' }); // Игры, ожидающие второго игрока
      res.json(challenges);
    } catch (error) {
      console.error('Ошибка при получении списка вызовов:', error);
      res.status(500).json({ message: req.t('controllers.game.challengesGetError') });
    }
  }

  // Создание вызова
  async createChallenge(req, res) {
    const { playerId, timeControl, format } = req.body;

    try {
      const player = await PlayerModel.findById(playerId);
      if (!player) {
        return res.status(404).json({ message: req.t('controllers.game.playerNotFound') });
      }

      const newGame = new GameModel({
        players: [{ player: playerId, color: 'white' }], // Создатель вызова становится белыми
        time: {
          white: timeControl.split('+')[0] * 60, // Минуты в секундах
          black: timeControl.split('+')[0] * 60,
        },
        format,
        status: 'waiting', // Ожидание второго игрока
      });

      await newGame.save();
      res.status(201).json(newGame);
    } catch (error) {
      console.error('Ошибка при создании вызова:', error);
      res.status(500).json({ message: req.t('controllers.game.challengeCreateError') });
    }
  }

  // Принятие вызова
  async acceptChallenge(req, res) {
    const { gameId } = req.params;
    const { playerId } = req.body;

    try {
      const game = await GameModel.findById(gameId);
      if (!game || game.status !== 'waiting') {
        return res.status(404).json({ message: req.t('controllers.game.challengeUnavailable') });
      }

      const player = await PlayerModel.findById(playerId);
      if (!player) {
        return res.status(404).json({ message: req.t('controllers.game.playerNotFound') });
      }

      game.players.push({ player: playerId, color: 'black' }); // Добавляем второго игрока как черных
      game.status = 'in_progress'; // Игра начинается
      await game.save();

      res.status(200).json({ message: req.t('controllers.game.challengeAccepted'), game });
    } catch (error) {
      console.error('Ошибка при принятии вызова:', error);
      res.status(500).json({ message: req.t('controllers.game.challengeAcceptError') });
    }
  }

  // Завершение игры
  async finishGame(req, res) {
    const { gameId } = req.params;
    const { winnerId, reason } = req.body;

    try {
      const game = await GameModel.findById(gameId);
      if (!game || game.status !== 'in_progress') {
        return res.status(400).json({ message: req.t('controllers.game.gameNotFoundOrFinished') });
      }

      game.status = 'finished';
      game.winner = winnerId || null; // Если ничья, winnerId будет null
      game.reason = reason; // Причина завершения игры (мат, время, сдача, ничья)
      game.updatedAt = Date.now();

      await game.save();
      res.status(200).json(game);
    } catch (error) {
      console.error('Ошибка при завершении игры:', error);
      res.status(500).json({ message: req.t('controllers.game.gameFinishError') });
    }
  }

  // Получение данных об игре
  async getGame(req, res) {
    const { gameId } = req.params;
    try {
      const game = await GameModel.findById(gameId).populate('players.player', '-password');
      if (!game) {
        return res.status(404).json({ message: req.t('controllers.game.gameNotFound') });
      }
      res.status(200).json(game);
    } catch (error) {
      console.error('Ошибка при получении данных игры:', error);
      res.status(500).json({ message: req.t('controllers.game.gameGetError') });
    }
  }
}

module.exports = new GameController();
