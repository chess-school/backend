const { Puzzle, Collection } = require('../models/Puzzle');
const User = require('../models/User');

class PuzzleController {
  async createPuzzle(req, res) {
    const { name, pgn, solution, collectionId } = req.body;
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      if (!user || !['coach', 'admin'].includes(user.role)) {
        return res.status(403).json({ msg: req.t('controllers.puzzles.accessDenied') });
      }

      const puzzle = new Puzzle({ name, pgn, solution, addedBy: userId });
      await puzzle.save();

      if (collectionId) {
        const collection = await Collection.findById(collectionId);
        if (!collection) {
          return res.status(404).json({ msg: req.t('controllers.puzzles.collectionNotFound') });
        }
        collection.puzzles.push(puzzle._id);
        await collection.save();
      }

      return res.status(201).json(puzzle);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: req.t('controllers.puzzles.createPuzzleError') });
    }
  }

  async deletePuzzle(req, res) {
    const { puzzleId } = req.params;
    const userId = req.user.id;

    try {
      const puzzle = await Puzzle.findById(puzzleId);
      if (!puzzle) {
        return res.status(404).json({ msg: req.t('controllers.puzzles.puzzleNotFound') });
      }

      if (puzzle.addedBy.toString() !== userId) {
        return res.status(403).json({ msg: req.t('controllers.puzzles.deletePuzzleForbidden') });
      }

      await puzzle.remove();

      // Удалить задачу из подборок
      await Collection.updateMany(
        { puzzles: puzzleId },
        { $pull: { puzzles: puzzleId } }
      );

      return res.json({ msg: req.t('controllers.puzzles.puzzleDeleted') });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: req.t('controllers.puzzles.deletePuzzleError') });
    }
  }

  async updatePuzzle(req, res) {
    const { puzzleId } = req.params;
    const { name, pgn, solution } = req.body;
    const userId = req.user.id;

    try {
      const puzzle = await Puzzle.findById(puzzleId);
      if (!puzzle) {
        return res.status(404).json({ msg: req.t('controllers.puzzles.puzzleNotFound') });
      }

      if (puzzle.addedBy.toString() !== userId) {
        return res.status(403).json({ msg: req.t('controllers.puzzles.updatePuzzleForbidden') });
      }

      puzzle.name = name || puzzle.name;
      puzzle.pgn = pgn || puzzle.pgn;
      puzzle.solution = solution || puzzle.solution;

      await puzzle.save();
      return res.json(puzzle);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: req.t('controllers.puzzles.updatePuzzleError') });
    }
  }

  async createCollection(req, res) {
    const { title, description } = req.body;
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      if (!user || !['coach', 'admin'].includes(user.role)) {
        return res.status(403).json({ msg: req.t('controllers.puzzles.accessDenied') });
      }

      const collection = new Collection({ title, description, createdBy: userId });
      await collection.save();
      return res.status(201).json(collection);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: req.t('controllers.puzzles.createCollectionError') });
    }
  }

  async deleteCollection(req, res) {
    const { collectionId } = req.params;
    const userId = req.user.id;

    try {
      const collection = await Collection.findById(collectionId);
      if (!collection) {
        return res.status(404).json({ msg: req.t('controllers.puzzles.collectionNotFound') });
      }

      if (collection.createdBy.toString() !== userId) {
        return res.status(403).json({ msg: req.t('controllers.puzzles.deleteCollectionForbidden') });
      }

      await collection.remove();
      return res.json({ msg: req.t('controllers.puzzles.collectionDeleted') });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: req.t('controllers.puzzles.deleteCollectionError') });
    }
  }

  async updateCollection(req, res) {
    const { collectionId } = req.params;
    const { title, description } = req.body;
    const userId = req.user.id;

    try {
      const collection = await Collection.findById(collectionId);
      if (!collection) {
        return res.status(404).json({ msg: req.t('controllers.puzzles.collectionNotFound') });
      }

      if (collection.createdBy.toString() !== userId) {
        return res.status(403).json({ msg: req.t('controllers.puzzles.updateCollectionForbidden') });
      }

      collection.title = title || collection.title;
      collection.description = description || collection.description;

      await collection.save();
      return res.json(collection);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: req.t('controllers.puzzles.updateCollectionError') });
    }
  }

  async getCollectionPuzzles(req, res) {
    const { collectionId } = req.params;

    try {
      const collection = await Collection.findById(collectionId).populate('puzzles');
      if (!collection) {
        return res.status(404).json({ msg: req.t('controllers.puzzles.collectionNotFound') });
      }

      return res.json(collection.puzzles);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: req.t('controllers.puzzles.getCollectionPuzzlesError') });
    }
  }
}

module.exports = new PuzzleController();
