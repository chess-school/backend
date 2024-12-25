const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const Role = require('../models/Role');

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: '/auth/google/callback',
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const { id, displayName, emails } = profile;
                const email = emails[0].value;

                let user = await User.findOne({ email });

                if (!user) {
                    const userRole = await Role.findOne({ value: "user" });
                    if (!userRole) {
                        throw new Error("Default role 'user' not found");
                    }

                    user = new User({
                        firebaseUID: id,
                        email,
                        firstName: displayName.split(' ')[0],
                        lastName: displayName.split(' ')[1] || '',
                        roles: [userRole.value],
                        emailVerified: true,
                    });

                    await user.save();
                }

                return done(null, user);
            } catch (error) {
                console.error('Error during Google OAuth:', error);
                return done(error, null);
            }
        }
    )
);

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

module.exports = passport;
