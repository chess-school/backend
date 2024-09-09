const mongoose = require('mongoose');

const RoleSchema = new mongoose.Schema({
    value: {
        type: String,
        unique: true,
        default: "User",
    }
});

module.exports = mongoose.model('Role', RoleSchema);
