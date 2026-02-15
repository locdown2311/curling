// ============================================================
// CURLING MULTIPLAYER SERVER
// Express + Socket.io with 50 fixed lobbies
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const TOTAL_LOBBIES = 50;
const GAME_VERSION = require('./package.json').version;

// ============================================================
// LOBBY MANAGER
// ============================================================

// Create 50 fixed lobbies
const lobbies = [];
for (let i = 1; i <= TOTAL_LOBBIES; i++) {
    lobbies.push({
        id: i,
        players: [],       // [{ id, nickname, team }]
        status: 'waiting',  // 'waiting' | 'playing' | 'finished'
        gameState: null
    });
}

function getLobbyList() {
    return lobbies.map(l => ({
        id: l.id,
        playerCount: l.players.length,
        status: l.status,
        players: l.players.map(p => ({ nickname: p.nickname, team: p.team }))
    }));
}

function findLobbyByPlayer(socketId) {
    return lobbies.find(l => l.players.some(p => p.id === socketId));
}

// ============================================================
// STATIC FILES
// ============================================================

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// SOCKET.IO EVENTS
// ============================================================

io.on('connection', (socket) => {
    console.log(`[+] Player connected: ${socket.id}`);

    let nickname = 'Jogador';
    let flag = '🏳️';

    // --- Set Nickname ---
    socket.on('set-nickname', (data) => {
        if (typeof data === 'object' && data !== null) {
            nickname = (data.name || 'Jogador').trim().substring(0, 20);
            flag = data.flag || '🏳️';
        } else {
            nickname = (data || 'Jogador').trim().substring(0, 20);
        }
        console.log(`[~] ${socket.id} set nickname: ${nickname} ${flag}`);
    });

    // Send server info (version + online count)
    socket.emit('server-info', {
        version: GAME_VERSION,
        onlineCount: io.engine.clientsCount
    });

    // Broadcast updated online count to all
    io.emit('online-count', io.engine.clientsCount);

    // --- Get Lobby List ---
    socket.on('get-lobbies', (callback) => {
        if (typeof callback === 'function') {
            callback(getLobbyList());
        }
    });

    // --- Join Lobby ---
    socket.on('join-lobby', (lobbyId, callback) => {
        const lobby = lobbies.find(l => l.id === lobbyId);
        if (!lobby) {
            return callback({ error: 'Sala não encontrada' });
        }

        // Leave any current lobby first
        const currentLobby = findLobbyByPlayer(socket.id);
        if (currentLobby) {
            leaveLobby(socket, currentLobby);
        }

        if (lobby.players.length >= 2) {
            return callback({ error: 'Sala cheia' });
        }

        // Assign team: first player = 0 (red), second = 1 (yellow)
        const team = lobby.players.length === 0 ? 0 : 1;
        lobby.players.push({ id: socket.id, nickname, flag, team });

        socket.join(`lobby-${lobbyId}`);
        console.log(`[>] ${nickname} joined lobby ${lobbyId} as team ${team}`);

        // Notify all in lobby
        io.to(`lobby-${lobbyId}`).emit('lobby-update', {
            id: lobby.id,
            players: lobby.players.map(p => ({ nickname: p.nickname, flag: p.flag, team: p.team })),
            status: lobby.status
        });

        // Broadcast lobby list update to everyone
        io.emit('lobbies-update', getLobbyList());

        callback({ success: true, team, lobbyId });

        // If 2 players are now in the lobby, start the game
        if (lobby.players.length === 2) {
            lobby.status = 'playing';
            io.to(`lobby-${lobbyId}`).emit('game-start', {
                players: lobby.players.map(p => ({ nickname: p.nickname, flag: p.flag, team: p.team }))
            });
            io.emit('lobbies-update', getLobbyList());
            console.log(`[!] Game started in lobby ${lobbyId}`);
        }
    });

    // --- Leave Lobby ---
    socket.on('leave-lobby', () => {
        const lobby = findLobbyByPlayer(socket.id);
        if (lobby) {
            leaveLobby(socket, lobby);
        }
    });

    // --- Game Actions (relay to opponent) ---
    socket.on('player-action', (action) => {
        const lobby = findLobbyByPlayer(socket.id);
        if (!lobby) return;

        // Relay action to the OTHER player in the lobby
        socket.to(`lobby-${lobby.id}`).emit('player-action', action);
    });

    // --- Game State Sync ---
    socket.on('game-state', (state) => {
        const lobby = findLobbyByPlayer(socket.id);
        if (!lobby) return;

        socket.to(`lobby-${lobby.id}`).emit('game-state', state);
    });

    // --- Game Over ---
    socket.on('game-over', (result) => {
        const lobby = findLobbyByPlayer(socket.id);
        if (!lobby) return;

        lobby.status = 'finished';
        io.to(`lobby-${lobby.id}`).emit('game-over-result', result);
        io.emit('lobbies-update', getLobbyList());
    });

    // --- Return to Lobby ---
    socket.on('return-to-lobby', () => {
        const lobby = findLobbyByPlayer(socket.id);
        if (lobby) {
            lobby.status = 'waiting';
            lobby.gameState = null;
            io.to(`lobby-${lobby.id}`).emit('lobby-update', {
                id: lobby.id,
                players: lobby.players.map(p => ({ nickname: p.nickname, team: p.team })),
                status: lobby.status
            });
            io.emit('lobbies-update', getLobbyList());
        }
    });

    // --- Disconnect ---
    socket.on('disconnect', () => {
        console.log(`[-] Player disconnected: ${socket.id} (${nickname})`);
        const lobby = findLobbyByPlayer(socket.id);
        if (lobby) {
            leaveLobby(socket, lobby);
        }
        // Broadcast updated online count
        io.emit('online-count', io.engine.clientsCount);
    });
});

function leaveLobby(socket, lobby) {
    const player = lobby.players.find(p => p.id === socket.id);
    if (!player) return;

    lobby.players = lobby.players.filter(p => p.id !== socket.id);
    socket.leave(`lobby-${lobby.id}`);

    // If game was in progress, notify other player
    if (lobby.status === 'playing') {
        lobby.status = 'waiting';
        lobby.gameState = null;
        io.to(`lobby-${lobby.id}`).emit('opponent-disconnected', {
            nickname: player.nickname
        });
    }

    // Reassign team for remaining player
    if (lobby.players.length === 1) {
        lobby.players[0].team = 0;
    }

    lobby.status = lobby.players.length > 0 ? 'waiting' : 'waiting';

    io.to(`lobby-${lobby.id}`).emit('lobby-update', {
        id: lobby.id,
        players: lobby.players.map(p => ({ nickname: p.nickname, team: p.team })),
        status: lobby.status
    });

    io.emit('lobbies-update', getLobbyList());
    console.log(`[<] ${player.nickname} left lobby ${lobby.id}`);
}

// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║     🥌 CURLING MULTIPLAYER 🥌       ║
║     Server running on :${PORT}         ║
║     ${TOTAL_LOBBIES} lobbies available             ║
╚══════════════════════════════════════╝
    `);
});
