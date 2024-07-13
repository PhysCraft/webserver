const pg = require('pg');

const { Client } = pg;
const client = new Client({
    user: process.env.PHYSCRAFT_PG_USER,
    password: process.env.PHYSCRAFT_PG_PASSWORD,
    host: process.env.PHYSCRAFT_PG_HOST,
    port: process.env.PHYSCRAFT_PG_PORT,
    database: process.env.PHYSCRAFT_PG_DATABASE,
});

module.exports.initialize = async function () {
    await client.connect();

    try {
        await client.query('BEGIN');

        // Create players table
        await client.query(`
CREATE TABLE IF NOT EXISTS players (
    minecraft_uuid TEXT PRIMARY KEY,
    email_hash TEXT,
    whitelisted BOOLEAN DEFAULT false
);
`);

        // Create whitelist_requests table
        await client.query(`
CREATE TABLE IF NOT EXISTS whitelist_requests (
    secret TEXT PRIMARY KEY,
    minecraft_uuid TEXT,
    email_hash TEXT,
    creation TIMESTAMP
);
`);

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        console.log(error);
    }
}

module.exports.add_whitelist_request = async function (uuid, hash, secret, creation) {
    await client.query('INSERT INTO whitelist_requests(minecraft_uuid, email_hash, secret, creation) VALUES ($1, $2, $3, to_timestamp($4))', [uuid, hash, secret, creation]);
}

module.exports.get_whitelist_request = async function (secret) {
    const res = await client.query('SELECT * FROM whitelist_requests WHERE secret = $1 ORDER BY creation DESC', [secret]);
    return res.rows[0];
}

module.exports.get_whitelist_by_email = async function (email) {
    const res = await client.query('SELECT * FROM whitelist_requests WHERE email_hash = $1 ORDER BY creation DESC', [email]);
    return res.rows[0];
}

module.exports.remove_whitelist_request = async function (secret) {
    await client.query('DELETE FROM whitelist_requests WHERE secret = $1', [secret]);
}

module.exports.add_player = async function (uuid, hash) {
    await client.query('INSERT INTO players(minecraft_uuid, email_hash) VALUES ($1, $2)', [uuid, hash]);
}

module.exports.get_player = async function (uuid) {
    const res = await client.query('SELECT * FROM players WHERE minecraft_uuid = $1', [uuid]);
    return res.rows[0];
}

module.exports.get_all_non_whitelisted_players = async function () {
    const res = await client.query('SELECT * FROM players WHERE whitelisted = false');
    return res.rows;
}

module.exports.set_player_whitelisted = async function (uuid) {
    await client.query('UPDATE players SET whitelisted = TRUE WHERE minecraft_uuid = $1', [uuid]);
}