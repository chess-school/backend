const SavedGame = require('../models/SavedGame');
const User = require('../models/User');

// 💾 Сохранить партию для студента (только для тренеров)
const saveGameForStudent = async (req, res) => {
    const { studentId, pgn, title, description } = req.body;
    const coachId = req.user.id; // ID тренера берется из токена

    if (!studentId || !pgn) {
        return res.status(400).json({ msg: 'Student ID and PGN are required.' });
    }

    const coach = await User.findById(coachId);

    if (!coach || !coach.roles.includes('coach')) {
        return res.status(403).json({ msg: 'Access denied. Only coaches can save games.' });
    }

    const isHisStudent = coach.students.some(s => s._id.toString() === studentId.toString());

    if (!isHisStudent) {
        return res.status(403).json({ msg: 'This user is not your student.' });
    }

    const newSavedGame = new SavedGame({
        coach: coachId,
        student: studentId,
        pgn,
        title,
        description,
    });

    await newSavedGame.save();

    res.status(201).json({ msg: 'Game saved successfully!', game: newSavedGame });
};


const getMySavedGames = async (req, res) => {
    const studentId = req.user.id; 

    const games = await SavedGame.find({ student: studentId })
        .populate('coach', 'firstName lastName') 
        .sort({ dateSaved: -1 });

    if (!games) {
        return res.status(200).json([]);
    }

    res.status(200).json(games);
};

module.exports = {
    saveGameForStudent,
    getMySavedGames,
};