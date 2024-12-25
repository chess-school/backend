const PlayerModel = require('../models/Player');
const GameModel = require('../models/Game');

function calculateK(rating, gamesPlayed) {
  if (gamesPlayed < 40) {
    return 40;
  } else if (rating < 2300) {
    return 20;
  } else {
    return 10; 
  }
}

function calculateElo(playerRating, opponentRating, result, gamesPlayed) {
  const K = calculateK(playerRating, gamesPlayed);
  const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  return Math.round(playerRating + K * (result - expectedScore));
}

class PlayerController {
  async getPlayer(req, res) {
    const { playerId } = req.params; 
    try {
      const player = await PlayerModel.findOne({ user: playerId }).populate('user', '-password');
      if (!player) {
        return res.status(404).json({ message: 'Игрок не найден' });
      }
      res.json(player);
    } catch (error) {
      console.error('Ошибка при получении игрока:', error);
      res.status(500).json({ error: 'Ошибка при получении игрока' });
    }
  }
  
  async getRating(req, res) {
    const { playerId, format } = req.params;
    try {
      const player = await PlayerModel.findById(playerId);
      if (!player || !player[format]) {
        return res.status(404).json({ message: `Формат "${format}" не найден` });
      }
      res.json({ rating: player[format].rating });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка при получении рейтинга' });
    }
  }

  async updateRating(req, res) {
    const { playerId, opponentId, format } = req.body;
    const { result } = req.body;
    try {
      const player = await PlayerModel.findById(playerId);
      const opponent = await PlayerModel.findById(opponentId);

      if (!player || !player[format]) {
        return res.status(404).json({ message: `Формат "${format}" не найден для игрока` });
      }
      if (!opponent || !opponent[format]) {
        return res.status(404).json({ message: `Формат "${format}" не найден для соперника` });
      }

      const playerData = player[format];
      const opponentData = opponent[format];

      const playerNewRating = calculateElo(playerData.rating, opponentData.rating, result, playerData.gamesPlayed);
      const opponentNewRating = calculateElo(opponentData.rating, playerData.rating, 1 - result, opponentData.gamesPlayed);

      playerData.gamesPlayed += 1;
      if (result === 1) {
        playerData.gamesWon += 1;
      } else if (result === 0.5) {
        playerData.gamesDrawn += 1;
      } else if (result === 0) {
        playerData.gamesLost += 1;
      }
      playerData.rating = playerNewRating;

      opponentData.gamesPlayed += 1;
      if (result === 1) {
        opponentData.gamesLost += 1;
      } else if (result === 0.5) {
        opponentData.gamesDrawn += 1;
      } else if (result === 0) {
        opponentData.gamesWon += 1;
      }
      opponentData.rating = opponentNewRating;

      await player.save();
      await opponent.save();

      res.json({
        message: 'Рейтинги обновлены',
        player: {
          newRating: playerNewRating,
          stats: playerData
        },
        opponent: {
          newRating: opponentNewRating,
          stats: opponentData
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка при обновлении рейтинга' });
    }
  }

  async getGames(req, res) {
    const { playerId } = req.params;
    try {
      const games = await GameModel.find({ 'players.player': playerId }).populate('players.player', 'user');
      res.json(games);
    } catch (error) {
      res.status(500).json({ error: 'Ошибка при получении игр' });
    }
  }

  async setActiveGame(req, res) {
    const { playerId, gameId } = req.params;
    try {
      const player = await PlayerModel.findById(playerId);
      if (!player) {
        return res.status(404).json({ message: 'Игрок не найден' });
      }
      player.activeGame = gameId;
      await player.save();
      res.json({ message: 'Активная игра установлена' });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка при установке активной игры' });
    }
  }

  async completeActiveGame(req, res) {
    const { playerId } = req.params;
    try {
      const player = await PlayerModel.findById(playerId);
      if (!player) {
        return res.status(404).json({ message: 'Игрок не найден' });
      }
      player.activeGame = null;
      await player.save();
      res.json({ message: 'Активная игра завершена' });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка при завершении активной игры' });
    }
  }
}

module.exports = new PlayerController();
