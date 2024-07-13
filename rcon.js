const ECO = require('@eco.js/rcon').ECO;
const axios = require('axios');

const database = require('./database.js')

async function get_rcon_client() {
    const rconClient = new ECO(process.env.PHYSCRAFT_RCON_HOST, process.env.PHYSCRAFT_RCON_PORT, process.env.PHYSCRAFT_RCON_PASSWORD);

    await rconClient.onReady;

    return rconClient;
};

module.exports.whitelist_player = async function (uuid) {
    try {
        rconClient = await get_rcon_client();

        let username_mut;
        try {
            const response = await axios.get(`https://api.mojang.com/user/profile/${uuid}`);
            username_mut = response.data.name;
        } catch (error) {
            console.log(error);
            return;
        }
        const username = username_mut;

        const server_response = await rconClient.send(`whitelist add ${username}`);

        await rconClient.disconnect();

        if (server_response.body.includes("Added") || server_response.body.includes("already"))
            database.set_player_whitelisted(uuid);
        else {
            console.error(`[WHITELIST_ERROR]: Unable to whitelist player ${username}`);
            console.error(JSON.stringify(server_response));
            return false;
        }
    } catch (error) {
        console.error(error);
        return false;
    }

    return true;
}

player_list = "";

// setInterval(async () => {
//     try {
//         rconClient = await get_rcon_client();

//         const player_list = await rconClient.send('list');
//         await rconClient.disconnect();

//         player_list = player_list.payload.split(':')[1];
//     } catch (error) {
//         player_list = "Server offline"
//     }
// }, 30 * 1000);

module.exports.get_online_players = async function () {
    return player_list;
}

module.exports.whitelist_all = async function () {
    const players = await database.get_all_non_whitelisted_players();

    players.forEach(async player => {
        this.whitelist_player(player.minecraft_uuid);
    })
}