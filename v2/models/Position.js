const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema({
    _id: { type: String }, 
    t: { type: Number },   
    m: [{                  
        _id: false,
        s: String, 
        g: Number, 
        w: Number, 
        d: Number, 
        l: Number, 
    }]
}, { _id: false, versionKey: false });

const Position = mongoose.model('Position', positionSchema);

module.exports = Position;