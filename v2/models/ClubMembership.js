// models/ClubMembership.js — принадлежность пользователя к клубу и его роль в этом клубе.
// Пользователь (TestUser) глобальный и может состоять в нескольких клубах с разными ролями
// (переключатель клуба в UI). Изоляция данных строится на связке club↔user↔role.

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ClubMembershipSchema = new Schema({
    club: { type: Schema.Types.ObjectId, ref: 'Club', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'TestUser', required: true, index: true },
    // Роль пользователя В ЭТОМ клубе (глобальные ADMIN-права — в TestUser.roles)
    role: { type: String, enum: ['owner', 'trainer', 'student', 'parent'], required: true },
    status: { type: String, enum: ['active', 'invited', 'removed'], default: 'active' },
    // Для роли parent — к каким ученикам привязан родитель (видит их успеваемость)
    children: [{ type: Schema.Types.ObjectId, ref: 'TestUser' }],
}, { timestamps: true });

// Одно членство на пару (клуб, пользователь)
ClubMembershipSchema.index({ club: 1, user: 1 }, { unique: true });
// Клубы пользователя (для свитчера) и участники клуба по роли
ClubMembershipSchema.index({ user: 1, status: 1 });
ClubMembershipSchema.index({ club: 1, role: 1, status: 1 });

module.exports = mongoose.model('ClubMembership', ClubMembershipSchema);
