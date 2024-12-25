const admin = require('firebase-admin');
const serviceAccount = require('../chess-online-bca59-firebase-adminsdk-zt8tv-c673d17c6b.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const auth = admin.auth();

module.exports = { auth };
