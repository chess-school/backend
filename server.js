const express = require('express');
const connectDB = require('./config/db');
const dotenv = require('dotenv');

dotenv.config();
connectDB();

const app = express();

app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/protected', require('./routes/protected'));
app.use('/api/trainer', require('./routes/trainer'));


const PORT = process.env.PORT || 5000;

const start = () => {
    try {
        app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
    } catch (err) {
        console.log(err);
    }
}

start();