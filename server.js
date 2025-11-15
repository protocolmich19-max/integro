const http = require('http');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const ranks = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const suits = ['♠', '♥', '♦', '♣'];
const rankValues = new Map(ranks.map((r, idx) => [r, idx]));

const rooms = new Map();

function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${rank}${suit}`);
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardSuit(card) {
  return card.slice(-1);
}

function cardRank(card) {
  return card.slice(0, card.length - 1);
}

function compareCards(cardA, cardB, trumpSuit) {
  const suitA = cardSuit(cardA);
  const suitB = cardSuit(cardB);
  if (suitA === suitB) {
    return rankValues.get(cardRank(cardA)) - rankValues.get(cardRank(cardB));
  }
  if (suitA === trumpSuit && suitB !== trumpSuit) {
    return 1;
  }
  if (suitB === trumpSuit && suitA !== trumpSuit) {
    return -1;
  }
  return null; // incomparable different suits without trump
}

function beats(defenseCard, attackCard, trumpSuit) {
  const suitAttack = cardSuit(attackCard);
  const suitDefense = cardSuit(defenseCard);
  if (suitAttack === suitDefense) {
    return rankValues.get(cardRank(defenseCard)) > rankValues.get(cardRank(attackCard));
  }
  if (suitDefense === trumpSuit && suitAttack !== trumpSuit) {
    return true;
  }
  return false;
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      players: new Map(),
      order: [],
      deck: [],
      discard: [],
      table: [],
      trumpCard: null,
      trumpSuit: null,
      attacker: null,
      defender: null,
      stage: 'waiting',
      status: 'Ожидание игроков',
      winner: null,
      lastUpdate: Date.now(),
      nextRoundTimeout: null,
    });
  }
  return rooms.get(roomId);
}

function addPlayerToRoom(room, name) {
  if (room.players.size >= 2) {
    return { error: 'В комнате уже 2 игрока. Попробуйте другую комнату.' };
  }
  const playerId = randomUUID();
  const player = {
    id: playerId,
    name: name || 'Игрок',
    credits: 1000,
    hand: [],
    joinedAt: Date.now(),
    lastSeen: Date.now(),
  };
  room.players.set(playerId, player);
  room.order.push(playerId);
  room.status = 'Ожидание второго игрока';
  room.winner = null;
  room.stage = 'waiting';
  room.table = [];
  room.deck = [];
  room.discard = [];
  if (room.players.size === 2) {
    startGame(room);
  }
  touchRoom(room);
  return { playerId };
}

function startGame(room) {
  room.deck = createDeck();
  room.trumpCard = room.deck[room.deck.length - 1];
  room.trumpSuit = cardSuit(room.trumpCard);
  room.discard = [];
  room.table = [];
  room.stage = 'attack';
  room.status = 'Игра началась';
  room.winner = null;
  clearTimeout(room.nextRoundTimeout);
  room.nextRoundTimeout = null;

  const players = room.order.map((id) => room.players.get(id)).filter(Boolean);
  players.forEach((p) => {
    p.hand = [];
  });

  // deal initial cards
  for (let i = 0; i < 6; i += 1) {
    players.forEach((player) => {
      if (room.deck.length > 0) {
        player.hand.push(room.deck.pop());
      }
    });
  }

  // determine attacker: player with lowest trump
  let attackerId = players[0]?.id || null;
  let lowestTrumpValue = Infinity;
  players.forEach((player) => {
    player.hand.forEach((card) => {
      if (cardSuit(card) === room.trumpSuit) {
        const value = rankValues.get(cardRank(card));
        if (value < lowestTrumpValue) {
          lowestTrumpValue = value;
          attackerId = player.id;
        }
      }
    });
  });
  if (!attackerId && players.length > 0) {
    attackerId = players[0].id;
  }
  const defenderId = players.find((p) => p.id !== attackerId)?.id || null;
  room.attacker = attackerId;
  room.defender = defenderId;
  room.status = `Ход игрока ${room.players.get(attackerId)?.name || ''}`;
  touchRoom(room);
}

function touchRoom(room) {
  room.lastUpdate = Date.now();
}

function removePlayer(room, playerId) {
  if (!room.players.has(playerId)) return;
  room.players.delete(playerId);
  room.order = room.order.filter((id) => id !== playerId);
  if (room.players.size < 2) {
    room.status = 'Ожидание игроков';
    room.stage = 'waiting';
    room.attacker = null;
    room.defender = null;
  }
  touchRoom(room);
}

function playAttack(room, playerId, card) {
  if (room.stage !== 'attack') {
    return { error: 'Сейчас нельзя атаковать' };
  }
  if (room.attacker !== playerId) {
    return { error: 'Сейчас ход другого игрока' };
  }
  const player = room.players.get(playerId);
  if (!player) return { error: 'Игрок не найден' };
  const cardIndex = player.hand.indexOf(card);
  if (cardIndex === -1) {
    return { error: 'У вас нет такой карты' };
  }
  const defender = room.players.get(room.defender);
  if (!defender) {
    return { error: 'Нет соперника' };
  }
  const maxCards = Math.min(6, defender.hand.length);
  if (room.table.length >= maxCards) {
    return { error: 'Нельзя подкинуть больше карт' };
  }
  if (room.table.length > 0) {
    const allowedRanks = new Set();
    room.table.forEach((pair) => {
      allowedRanks.add(cardRank(pair.attack));
      if (pair.defense) allowedRanks.add(cardRank(pair.defense));
    });
    if (!allowedRanks.has(cardRank(card))) {
      return { error: 'Можно подкидывать только карты по достоинству на столе' };
    }
  }
  player.hand.splice(cardIndex, 1);
  room.table.push({ attack: card, defense: null });
  room.stage = 'defense';
  room.status = `Защищается ${defender.name}`;
  touchRoom(room);
  return { ok: true };
}

function playDefense(room, playerId, card, targetIndex) {
  if (room.stage !== 'defense') {
    return { error: 'Сейчас нельзя отбиваться' };
  }
  if (room.defender !== playerId) {
    return { error: 'Сейчас защищается другой игрок' };
  }
  const pair = room.table[targetIndex];
  if (!pair) {
    return { error: 'Нет такой атаки' };
  }
  if (pair.defense) {
    return { error: 'Эта карта уже побита' };
  }
  const player = room.players.get(playerId);
  const idx = player.hand.indexOf(card);
  if (idx === -1) {
    return { error: 'У вас нет такой карты' };
  }
  if (!beats(card, pair.attack, room.trumpSuit)) {
    return { error: 'Карта не бьёт атаку' };
  }
  player.hand.splice(idx, 1);
  pair.defense = card;
  const allBeaten = room.table.every((p) => p.defense);
  if (allBeaten) {
    room.stage = 'attack';
    const attacker = room.players.get(room.attacker);
    room.status = `Подкидывает ${attacker?.name || ''}`;
  }
  touchRoom(room);
  return { ok: true };
}

function defenderTakes(room, playerId) {
  if (room.defender !== playerId) {
    return { error: 'Только защищающийся может брать' };
  }
  if (room.table.length === 0) {
    return { error: 'На столе нет карт' };
  }
  const defender = room.players.get(playerId);
  room.table.forEach((pair) => {
    defender.hand.push(pair.attack);
    if (pair.defense) defender.hand.push(pair.defense);
  });
  room.table = [];
  room.stage = 'attack';
  room.status = `${defender.name} взял карты. Ход остаётся за ${room.players.get(room.attacker)?.name || ''}`;
  refillHands(room);
  checkWinner(room);
  touchRoom(room);
  return { ok: true };
}

function endTurn(room, playerId) {
  if (room.attacker !== playerId) {
    return { error: 'Только атакующий может завершить ход' };
  }
  if (room.table.length === 0) {
    return { error: 'Нужно сходить картой' };
  }
  if (!room.table.every((pair) => pair.defense)) {
    return { error: 'Ещё остались непокрытые карты' };
  }
  moveToDiscard(room);
  rotateRoles(room);
  refillHands(room);
  checkWinner(room);
  touchRoom(room);
  return { ok: true };
}

function moveToDiscard(room) {
  room.table.forEach((pair) => {
    room.discard.push(pair.attack);
    if (pair.defense) room.discard.push(pair.defense);
  });
  room.table = [];
}

function rotateRoles(room) {
  const prevAttacker = room.attacker;
  room.attacker = room.defender;
  const players = room.order.filter((id) => room.players.has(id));
  if (players.length === 2) {
    room.defender = players.find((id) => id !== room.attacker) || null;
  } else {
    room.defender = null;
  }
  const attackerPlayer = room.players.get(room.attacker);
  if (attackerPlayer) {
    room.status = `Ход игрока ${attackerPlayer.name}`;
  }
  room.stage = 'attack';
}

function refillHands(room) {
  const playersOrder = [];
  const attacker = room.players.get(room.attacker);
  const defender = room.players.get(room.defender);
  if (attacker) playersOrder.push(attacker);
  if (defender) playersOrder.push(defender);
  playersOrder.forEach((player) => {
    while (player.hand.length < 6 && room.deck.length > 0) {
      player.hand.push(room.deck.pop());
    }
  });
}

function checkWinner(room) {
  if (room.winner) return;
  const players = room.order.map((id) => room.players.get(id)).filter(Boolean);
  if (players.length < 2) return;
  const deckEmpty = room.deck.length === 0;
  const attacker = room.players.get(room.attacker);
  const defender = room.players.get(room.defender);
  const others = players.filter((p) => p.id !== room.attacker && p.id !== room.defender);
  if (deckEmpty) {
    const winners = players.filter((p) => p.hand.length === 0);
    if (winners.length === 1) {
      declareWinner(room, winners[0]);
    } else if (winners.length === players.length) {
      room.status = 'Ничья — все без карт';
      room.winner = 'draw';
      scheduleNextRound(room);
      return;
    }
  }
  if (attacker && attacker.hand.length === 0 && deckEmpty) {
    declareWinner(room, attacker);
  }
  if (defender && defender.hand.length === 0 && deckEmpty) {
    declareWinner(room, defender);
  }
  others.forEach((p) => {
    if (p.hand.length === 0 && deckEmpty) {
      declareWinner(room, p);
    }
  });
}

function declareWinner(room, player) {
  if (room.winner) return;
  if (!player) return;
  room.winner = player.id;
  player.credits += 50;
  const loser = room.order.map((id) => room.players.get(id)).find((p) => p && p.id !== player.id);
  if (loser) {
    loser.credits = Math.max(0, loser.credits - 50);
  }
  room.status = `Победил ${player.name}!`; 
  scheduleNextRound(room);
}

function scheduleNextRound(room) {
  if (room.nextRoundTimeout) return;
  room.nextRoundTimeout = setTimeout(() => {
    if (room.players.size === 2) {
      startGame(room);
    } else {
      room.stage = 'waiting';
      room.status = 'Ожидание игроков';
    }
  }, 5000);
}

function serializeState(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) {
    return { error: 'Игрок не найден' };
  }
  player.lastSeen = Date.now();
  const opponent = [...room.players.values()].find((p) => p.id !== playerId) || null;
  const opponentRole = opponent
    ? room.attacker === opponent.id
      ? 'attacker'
      : room.defender === opponent.id
        ? 'defender'
        : 'observer'
    : null;
  const opponentInfo = opponent
    ? {
        id: opponent.id,
        name: opponent.name,
        handCount: opponent.hand.length,
        credits: opponent.credits,
        role: opponentRole,
      }
    : null;
  const table = room.table.map((pair) => ({ attack: pair.attack, defense: pair.defense }));
  const isAttacker = room.attacker === playerId;
  const isDefender = room.defender === playerId;
  return {
    roomId: room.id,
    you: {
      id: player.id,
      name: player.name,
      credits: player.credits,
      hand: player.hand,
      role: isAttacker ? 'attacker' : isDefender ? 'defender' : 'observer',
    },
    opponent: opponentInfo,
    deckCount: room.deck.length,
    trumpCard: room.trumpCard,
    trumpSuit: room.trumpSuit,
    table,
    stage: room.stage,
    status: room.status,
    winner: room.winner,
    discardCount: room.discard.length,
    timestamp: room.lastUpdate,
  };
}

function respondJSON(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      if (url.pathname === '/api/join' && req.method === 'POST') {
        const body = await parseBody(req);
        const roomId = body.roomId || 'default';
        const name = body.name?.toString().substring(0, 20) || 'Игрок';
        const room = getOrCreateRoom(roomId);
        const result = addPlayerToRoom(room, name);
        if (result.error) {
          respondJSON(res, { error: result.error }, 400);
        } else {
          respondJSON(res, { playerId: result.playerId, state: serializeState(room, result.playerId) });
        }
        return;
      }
      if (url.pathname === '/api/state' && req.method === 'GET') {
        const roomId = url.searchParams.get('roomId') || 'default';
        const playerId = url.searchParams.get('playerId');
        const room = getOrCreateRoom(roomId);
        if (!playerId) {
          respondJSON(res, { error: 'playerId обязателен' }, 400);
          return;
        }
        const state = serializeState(room, playerId);
        if (state.error) {
          respondJSON(res, state, 400);
        } else {
          respondJSON(res, state);
        }
        return;
      }
      if (url.pathname === '/api/action' && req.method === 'POST') {
        const body = await parseBody(req);
        const { roomId = 'default', playerId, type, payload } = body;
        const room = getOrCreateRoom(roomId);
        if (!playerId || !room.players.has(playerId)) {
          respondJSON(res, { error: 'Игрок не найден' }, 400);
          return;
        }
        let result;
        if (type === 'attack') {
          result = playAttack(room, playerId, payload?.card);
        } else if (type === 'defense') {
          result = playDefense(room, playerId, payload?.card, payload?.index);
        } else if (type === 'take') {
          result = defenderTakes(room, playerId);
        } else if (type === 'endTurn') {
          result = endTurn(room, playerId);
        } else {
          result = { error: 'Неизвестное действие' };
        }
        if (result && result.error) {
          respondJSON(res, result, 400);
        } else {
          respondJSON(res, { ok: true, state: serializeState(room, playerId) });
        }
        return;
      }
      respondJSON(res, { error: 'Неизвестный запрос' }, 404);
    } catch (error) {
      console.error(error);
      respondJSON(res, { error: 'Ошибка сервера' }, 500);
    }
    return;
  }

  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = filePath.replace(/\.\./g, '');
  const absolutePath = path.join(PUBLIC_DIR, filePath);
  fs.stat(absolutePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = ext === '.css'
      ? 'text/css'
      : ext === '.js'
        ? 'application/javascript'
        : ext === '.json'
          ? 'application/json'
          : 'text/html';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(absolutePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
