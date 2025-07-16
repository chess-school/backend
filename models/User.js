const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const StudentSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    firstName: String,
    lastName: String,
    email: String
});

const UserSchema = new mongoose.Schema({
    firebaseUID: {
        type: String,
        unique: true,
        sparse: true,
    },
    firstName: {
        type: String,
        required: true
    },
    lastName: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    emailVerified: { type: Boolean, 
        default: false 
    }, 
    verificationToken: { 
        type: String 
    },
    password: {
        type: String,
        required: true
    },
    roles: {
        type: [String],
        default: []
    },
    students: [StudentSchema],
    trainer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    avatar: {
        data: Buffer,
        contentType: String,
    },      
    trainerEmail: {
        type: String
    },
    coachProfile: {
        title: { type: String, default: '' },
        experience: { type: String, default: '' },
        bio: { type: String, default: '' },
        price: { type: Number, default: 0 },
        services: { type: [String], default: [] }
    },
    sessionTokenVersion: {
        type: Number,
        default: 0
    },
    registrationDate: {
        type: Date,
        default: Date.now
    }
});

UserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

UserSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', UserSchema);
