const joinOverlay = document.getElementById('join-overlay');
const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');
const roomInput = document.getElementById('room-input');
const statusEl = document.getElementById('status');
const timerEl = document.getElementById('timer');
const youNameEl = document.getElementById('you-name');
const youRoleEl = document.getElementById('you-role');
const youCreditsEl = document.getElementById('you-credits');
const yourHandEl = document.getElementById('your-hand');
const opponentNameEl = document.getElementById('opponent-name');
const opponentRoleEl = document.getElementById('opponent-role');
const opponentCreditsEl = document.getElementById('opponent-credits');
const opponentHandEl = document.getElementById('opponent-hand');
const deckCountEl = document.getElementById('deck-count');
const discardCountEl = document.getElementById('discard-count');
const trumpCardEl = document.getElementById('trump-card');
const tableCardsEl = document.getElementById('table-cards');
const takeButton = document.getElementById('take-button');
const endTurnButton = document.getElementById('end-turn-button');
const logEl = document.getElementById('log');

const rankOrder = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const rankValue = new Map(rankOrder.map((rank, index) => [rank, index]));

let playerId = null;
let roomId = 'default';
let pollTimer = null;
let currentState = null;
let lastStatus = '';
let actionPending = false;

function classForSuit(suit) {
  switch (suit) {
    case '♥':
      return 'heart';
    case '♦':
      return 'diamond';
    case '♣':
      return 'club';
    default:
      return 'spade';
  }
}

function beats(defenseCard, attackCard, trumpSuit) {
  const defSuit = defenseCard.slice(-1);
  const atkSuit = attackCard.slice(-1);
  const defRank = defenseCard.slice(0, defenseCard.length - 1);
  const atkRank = attackCard.slice(0, attackCard.length - 1);
  if (defSuit === atkSuit) {
    return rankValue.get(defRank) > rankValue.get(atkRank);
  }
  if (defSuit === trumpSuit && atkSuit !== trumpSuit) {
    return true;
  }
  return false;
}

function createCardElement(card, options = {}) {
  const template = document.getElementById('card-template');
  const element = template.content.firstElementChild.cloneNode(true);
  const rank = card.slice(0, card.length - 1);
  const suit = card.slice(-1);
  element.querySelector('.rank').textContent = rank;
  element.querySelector('.suit').textContent = suit;
  element.classList.add(classForSuit(suit));
  element.dataset.card = card;
  if (options.disabled) {
    element.classList.add('disabled');
  }
  if (options.extraClass) {
    element.classList.add(options.extraClass);
  }
  return element;
}

function renderState(state) {
  currentState = state;
  statusEl.textContent = state.status;
  timerEl.textContent = state.winner ? 'Новая партия через 5 секунд' : '';

  youNameEl.textContent = state.you.name;
  youCreditsEl.textContent = `${state.you.credits} ⚜`;
  youRoleEl.textContent = roleLabel(state.you.role);

  deckCountEl.textContent = state.deckCount;
  discardCountEl.textContent = state.discardCount;
  renderTrump(state.trumpCard);

  renderHand(state);
  renderOpponent(state);
  renderTable(state);
  updateButtons(state);

  if (state.status !== lastStatus) {
    appendLog(state.status);
    lastStatus = state.status;
  }
}

function renderTrump(card) {
  trumpCardEl.innerHTML = '';
  if (!card) {
    trumpCardEl.classList.add('empty');
    return;
  }
  trumpCardEl.classList.remove('empty');
  const el = createCardElement(card, { disabled: true });
  trumpCardEl.appendChild(el);
}

function roleLabel(role) {
  switch (role) {
    case 'attacker':
      return 'Атакующий';
    case 'defender':
      return 'Защищающийся';
    default:
      return 'Наблюдатель';
  }
}

function cardPlayableForAttack(card, state) {
  if (state.you.role !== 'attacker') return false;
  if (state.stage !== 'attack') return false;
  const defenderHand = state.opponent ? state.opponent.handCount : 0;
  if (state.table.length >= Math.min(6, defenderHand)) return false;
  if (state.table.length === 0) return true;
  const ranksOnTable = new Set();
  state.table.forEach((pair) => {
    ranksOnTable.add(pair.attack.slice(0, pair.attack.length - 1));
    if (pair.defense) {
      ranksOnTable.add(pair.defense.slice(0, pair.defense.length - 1));
    }
  });
  const rank = card.slice(0, card.length - 1);
  return ranksOnTable.has(rank);
}

function cardPlayableForDefense(card, state) {
  if (state.you.role !== 'defender') return false;
  if (state.stage !== 'defense') return false;
  const pendingIndex = state.table.findIndex((pair) => !pair.defense);
  if (pendingIndex === -1) return false;
  const pendingCard = state.table[pendingIndex].attack;
  return beats(card, pendingCard, state.trumpSuit);
}

function renderHand(state) {
  yourHandEl.innerHTML = '';
  state.you.hand.forEach((card) => {
    const disabled = !(cardPlayableForAttack(card, state) || cardPlayableForDefense(card, state));
    const cardEl = createCardElement(card, { disabled });
    cardEl.addEventListener('click', () => {
      if (cardEl.classList.contains('disabled') || actionPending) return;
      if (cardPlayableForAttack(card, state)) {
        sendAction('attack', { card });
      } else if (cardPlayableForDefense(card, state)) {
        const index = state.table.findIndex((pair) => !pair.defense);
        if (index !== -1) {
          sendAction('defense', { card, index });
        }
      }
    });
    yourHandEl.appendChild(cardEl);
  });
}

function renderOpponent(state) {
  opponentHandEl.innerHTML = '';
  if (!state.opponent) {
    opponentNameEl.textContent = 'Ожидание соперника';
    opponentRoleEl.textContent = '';
    opponentCreditsEl.textContent = '';
    return;
  }
  opponentNameEl.textContent = state.opponent.name;
  opponentCreditsEl.textContent = `${state.opponent.credits} ⚜`;
  opponentRoleEl.textContent = roleLabel(state.opponent.role);
  for (let i = 0; i < state.opponent.handCount; i += 1) {
    const cardEl = createCardElement('??', { disabled: true });
    cardEl.classList.add('back');
    opponentHandEl.appendChild(cardEl);
  }
}

function renderTable(state) {
  tableCardsEl.innerHTML = '';
  state.table.forEach((pair) => {
    const slot = document.createElement('div');
    slot.className = 'table-pair';
    const attackCard = createCardElement(pair.attack, { disabled: true });
    slot.appendChild(attackCard);
    if (pair.defense) {
      const defenseCard = createCardElement(pair.defense, { disabled: true, extraClass: 'defense' });
      defenseCard.classList.add('defense');
      slot.appendChild(defenseCard);
    }
    tableCardsEl.appendChild(slot);
  });
}

function updateButtons(state) {
  const canTake = state.you.role === 'defender' && state.stage === 'defense' && state.table.length > 0;
  takeButton.disabled = !(canTake && !actionPending);
  const canEndTurn =
    state.you.role === 'attacker' &&
    state.stage === 'attack' &&
    state.table.length > 0 &&
    state.table.every((pair) => pair.defense);
  endTurnButton.disabled = !(canEndTurn && !actionPending);
}

function appendLog(message, type = 'info') {
  const entry = document.createElement('li');
  entry.innerHTML = `<span>•</span> ${message}`;
  entry.dataset.type = type;
  logEl.prepend(entry);
  while (logEl.childElementCount > 40) {
    logEl.removeChild(logEl.lastElementChild);
  }
}

async function joinGame(name, room) {
  try {
    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, roomId: room }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Не удалось подключиться');
    }
    playerId = data.playerId;
    roomId = room;
    joinOverlay.classList.add('hidden');
    renderState(data.state);
    schedulePoll();
  } catch (error) {
    appendLog(error.message, 'error');
    statusEl.textContent = error.message;
  }
}

async function fetchState() {
  if (!playerId) return;
  try {
    const res = await fetch(`/api/state?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Ошибка запроса состояния');
    }
    renderState(data);
  } catch (error) {
    appendLog(error.message, 'error');
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await fetchState();
    schedulePoll();
  }, 1200);
}

async function sendAction(type, payload) {
  if (!playerId) return;
  actionPending = true;
  updateButtons(currentState);
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, playerId, type, payload }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Не удалось выполнить действие');
    }
    if (data.state) {
      renderState(data.state);
    } else {
      await fetchState();
    }
  } catch (error) {
    appendLog(error.message, 'error');
  } finally {
    actionPending = false;
    updateButtons(currentState);
  }
}

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInput.value.trim() || 'Игрок';
  const room = roomInput.value.trim() || 'default';
  joinGame(name, room);
});

takeButton.addEventListener('click', () => {
  if (!takeButton.disabled) {
    sendAction('take');
  }
});

endTurnButton.addEventListener('click', () => {
  if (!endTurnButton.disabled) {
    sendAction('endTurn');
  }
});

appendLog('Готовы к подключению. Заполните форму, чтобы начать.');
