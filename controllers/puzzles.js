const { Puzzle, Collection } = require('../models/Puzzle');
const User = require('../models/User');

class PuzzleController {
  async createPuzzle(req, res) {
    const { name, pgn, solution, collectionId } = req.body;
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      if (!user || !['coach', 'admin'].includes(user.role)) {
        return res.status(403).json({ msg: 'Access denied' });
      }

      const puzzle = new Puzzle({ name, pgn, solution, addedBy: userId });
      await puzzle.save();

      if (collectionId) {
        const collection = await Collection.findById(collectionId);
        if (!collection) {
          return res.status(404).json({ msg: 'Collection not found' });
        }
        collection.puzzles.push(puzzle._id);
        await collection.save();
      }

      return res.status(201).json(puzzle);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to create puzzle' });
    }
  }

  async deletePuzzle(req, res) {
    const { puzzleId } = req.params;
    const userId = req.user.id;

    try {
      const puzzle = await Puzzle.findById(puzzleId);
      if (!puzzle) {
        return res.status(404).json({ msg: 'Puzzle not found' });
      }

      if (puzzle.addedBy.toString() !== userId) {
        return res.status(403).json({ msg: 'You are not allowed to delete this puzzle' });
      }

      await puzzle.remove();

      // Удалить задачу из подборок
      await Collection.updateMany(
        { puzzles: puzzleId },
        { $pull: { puzzles: puzzleId } }
      );

      return res.json({ msg: 'Puzzle deleted successfully' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to delete puzzle' });
    }
  }

  async updatePuzzle(req, res) {
    const { puzzleId } = req.params;
    const { name, pgn, solution } = req.body;
    const userId = req.user.id;

    try {
      const puzzle = await Puzzle.findById(puzzleId);
      if (!puzzle) {
        return res.status(404).json({ msg: 'Puzzle not found' });
      }

      if (puzzle.addedBy.toString() !== userId) {
        return res.status(403).json({ msg: 'You are not allowed to update this puzzle' });
      }

      puzzle.name = name || puzzle.name;
      puzzle.pgn = pgn || puzzle.pgn;
      puzzle.solution = solution || puzzle.solution;

      await puzzle.save();
      return res.json(puzzle);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to update puzzle' });
    }
  }

  async createCollection(req, res) {
    const { title, description } = req.body;
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);
      if (!user || !['coach', 'admin'].includes(user.role)) {
        return res.status(403).json({ msg: 'Access denied' });
      }

      const collection = new Collection({ title, description, createdBy: userId });
      await collection.save();
      return res.status(201).json(collection);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to create collection' });
    }
  }

  async deleteCollection(req, res) {
    const { collectionId } = req.params;
    const userId = req.user.id;

    try {
      const collection = await Collection.findById(collectionId);
      if (!collection) {
        return res.status(404).json({ msg: 'Collection not found' });
      }

      if (collection.createdBy.toString() !== userId) {
        return res.status(403).json({ msg: 'You are not allowed to delete this collection' });
      }

      await collection.remove();
      return res.json({ msg: 'Collection deleted successfully' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to delete collection' });
    }
  }

  async updateCollection(req, res) {
    const { collectionId } = req.params;
    const { title, description } = req.body;
    const userId = req.user.id;

    try {
      const collection = await Collection.findById(collectionId);
      if (!collection) {
        return res.status(404).json({ msg: 'Collection not found' });
      }

      if (collection.createdBy.toString() !== userId) {
        return res.status(403).json({ msg: 'You are not allowed to update this collection' });
      }

      collection.title = title || collection.title;
      collection.description = description || collection.description;

      await collection.save();
      return res.json(collection);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to update collection' });
    }
  }

  async getCollectionPuzzles(req, res) {
    const { collectionId } = req.params;

    try {
      const collection = await Collection.findById(collectionId).populate('puzzles');
      if (!collection) {
        return res.status(404).json({ msg: 'Collection not found' });
      }

      return res.json(collection.puzzles);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to get collection puzzles' });
    }
  }
}

module.exports = new PuzzleController();
