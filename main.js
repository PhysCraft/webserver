const express = require('express');
const multer = require('multer');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const validator = require('email-validator');
const axios = require('axios');
const crypto = require('crypto');
var serveIndex = require('serve-index');
const FormData = require('form-data');


const database = require('./database.js');
const rcon = require('./rcon.js');

const app = express();
const port = 3001;

const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/bills', express.static('./bills/'), serveIndex('bills', {
    icons: true,
    filter: (filename) => filename.endsWith(".pdf"),
}));

app.use('/static', express.static('./pages/static/'));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'pages'));

app.get('/', async (req, res) => {
    res.render('index', {
        address: process.env.PHYSCRAFT_ADDRESS,
        online_players: await rcon.get_online_players(),
    });
});

app.get('/about', async (req, res) => {
    res.render('about');
});

app.post('/whitelist_request', async function (req, res) {
    const username = req.body.username.trim();
    const email = req.body.email.trim().toLowerCase();
    const captcha_token = req.body['g-recaptcha-response'];

    // Verify captcha
    try {
        const response = await axios.postForm(`https://api.hcaptcha.com/siteverify`, {
            response: captcha_token,
            secret: process.env.PHYSCRAFT_HCAPTCHA_SECRET
        });

        if (!response.data.success) {
            res.render('whitelist_denied', { error: 'invalid_captcha', username, });
            return;
        }
    } catch (error) {
        res.render('whitelist_denied', { error: 'invalid_captcha', username, });
        return;
    }

    // Checks if email is in a valid format.
    if (!validator.validate(email)) {
        res.render('whitelist_denied', { error: 'invalid_email', email, });
        return;
    }

    // Check if email ends in studenti.uniroma1.it
    if (!email.endsWith('studenti.uniroma1.it')) {
        res.render('whitelist_denied', { error: 'invalid_email', email, });
        return;
    }


    // Check if username matches format
    if (!/^[a-zA-Z0-9_]{2,16}$/.test(username)) {
        res.render('whitelist_denied', { error: 'invalid_username', username, });
        return;
    }

    // Check if usernames exists and gets uuid
    let uuid_mut;
    try {
        const response = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${username}`);
        uuid_mut = response.data.id;
    } catch (error) {
        res.render('whitelist_denied', { error: 'invalid_username', username, });
        return;
    }
    const uuid = uuid_mut;

    // Check if player is already registered 
    if (await database.get_player(uuid)) {
        res.render('whitelist_denied', { error: 'redundant_username', username, });
        return;
    }

    const email_hash = crypto.createHash('sha256').update(email).digest('hex');

    // Check if an email has been already sent in the last 20 minutes
    const last_request = await database.get_whitelist_by_email(email_hash);
    if (last_request && Date.now() - last_request.creation < 20 * 60 * 1000) {
        res.render('whitelist_denied', { error: 'ratelimit_email', email, });
        return;
    }

    // Send verification email
    const secret = crypto.randomBytes(32).toString('hex');
    try {
        let message = await ejs.renderFile(path.join(__dirname, 'pages', 'verification_email.ejs'), {
            verification_url: `${process.env.PHYSCRAFT_WEB_URL}/whitelist_verify?secret=${secret}`,
            discord_url: process.env.PHYSCRAFT_DISCORD_URL,
        });

        const form = new FormData();

        form.append('from', process.env.PHYSCRAFT_MAILEROO_FROM);
        form.append('to', email);
        form.append('subject', 'PhysCraft - Email verification');
        form.append('html', message);
        form.append('tracking', 'no');

        const response = await axios.post('https://smtp.maileroo.com/send', form, {
            headers: {
                ...form.getHeaders(),
                'X-API-Key': process.env.PHYSCRAFT_MAILEROO_APIKEY
            }
        });

        if (response.status != 200) {
            res.render('whitelist_denied', { error: 'invalid_email', email, });
            return;
        }
    } catch (error) {
        res.render('whitelist_denied', { error: 'invalid_email', email, });
        return;
    }

    await database.add_whitelist_request(uuid, email_hash, secret, Date.now());

    res.render('whitelist_request', { email, });
});

app.get('/whitelist_verify', async (req, res) => {
    if (req.query.secret == '' || req.query.secret == undefined) {
        res.render('whitelist_denied', { error: 'invalid_secret', });
        return;
    }

    const whitelist_request = await database.get_whitelist_request(req.query.secret);

    if (whitelist_request == undefined) {
        res.render('whitelist_denied', { error: 'invalid_secret', });
        return;
    }

    res.render('whitelist_accepted', {
        discord_url: process.env.PHYSCRAFT_DISCORD_URL,
    });

    // Move from whitelist_requests to players table
    await database.add_player(whitelist_request.minecraft_uuid, whitelist_request.email_hash);
    await database.remove_whitelist_request(req.query.secret);

    // Use rcon to communicate the news to Fabric
    await rcon.whitelist_player(whitelist_request.minecraft_uuid);
});

const bill_upload = multer({ dest: 'bills/' });
app.post("/bill_upload", bill_upload.single("file"), async (req, res) => {
    const password = req.header('x-physcraft-admin-password');
    if (password !== process.env.PHYSCRAFT_ADMIN_PASSWORD) {
        return res.status(401).send('Unauthorized');
    }

    const file = req.file;
    if (!file) {
        return res.status(400).send('No file uploaded.');
    }

    // Sanitize the filename
    const filename = path.basename(file.originalname).replace(/[\x00-\x1f\x7f/\\]/g, '');
    const targetPath = path.join(__dirname, "bills", filename);

    // Ensure the targetPath is within the expected directory
    if (!targetPath.startsWith(path.join(__dirname, 'bills'))) {
        return res.status(400).send('Invalid file path.');
    }

    fs.rename(file.path, targetPath, (err) => {
        if (err) {
            return res.status(500).send('Error saving file.');
        }
        res.send(`File uploaded successfully: ${filename}`);
    });
});


app.listen(port, async () => {
    console.log(`Server is running on http://localhost:${port}`);

    await database.initialize();

    await rcon.whitelist_all();
    setInterval(async () => await rcon.whitelist_all(), 300 * 1000);
});