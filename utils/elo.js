const calculateK = (rating, gamesPlayed) => {
    return gamesPlayed < 40 ? 40 : rating < 2300 ? 20 : 10;
};

const calculateElo = (playerRating, opponentRating, result, gamesPlayed) => {
    const K = calculateK(playerRating, gamesPlayed);
    const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
    return Math.round(playerRating + K * (result - expectedScore));
};

module.exports = { calculateElo };
