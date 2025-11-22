const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const rankValues = { "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14 };

const state = {
    deck: [],
    players: [
        { id: "you", name: "Вы", bank: 120, hand: [], folded: false, bet: 0, isBot: false, log: [] },
        { id: "bot1", name: "Андрей", bank: 120, hand: [], folded: false, bet: 0, isBot: true, log: [] },
        { id: "bot2", name: "Марина", bank: 120, hand: [], folded: false, bet: 0, isBot: true, log: [] },
    ],
    pot: 0,
    currentBet: 0,
    phase: "idle",
    message: "Нажмите «Новый кон», чтобы начать партию",
};

const logEl = document.querySelector("#log");
const potEl = document.querySelector("#pot");
const betSlider = document.querySelector("#bet-size");
const betValue = document.querySelector("#bet-value");
const dealButton = document.querySelector("#deal");
const betButton = document.querySelector("#bet");
const showdownButton = document.querySelector("#showdown");
const passButton = document.querySelector("#pass");

function createDeck() {
    const deck = [];
    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push({ suit, rank, value: rankValues[rank] });
        }
    }
    return deck;
}

function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
}

function ante() {
    state.pot = 0;
    state.currentBet = 0;
    state.players.forEach((p) => {
        const contribution = Math.min(2, p.bank);
        p.bank -= contribution;
        state.pot += contribution;
        p.bet = 0;
        p.folded = false;
        p.log = [];
    });
}

function dealHands() {
    state.deck = createDeck();
    shuffle(state.deck);
    for (let i = 0; i < 3; i += 1) {
        state.players.forEach((player) => {
            player.hand.push(state.deck.pop());
        });
    }
}

function updateBetValue() {
    betValue.textContent = `${betSlider.value} монет`;
}

function renderCard(card, hidden) {
    const cardEl = document.createElement("div");
    cardEl.className = "card";

    if (hidden) {
        cardEl.classList.add("face-down");
        cardEl.textContent = "SV";
        return cardEl;
    }

    const isRed = card.suit === "♥" || card.suit === "♦";
    if (isRed) cardEl.classList.add("red");

    const top = document.createElement("div");
    top.className = "suit";
    top.textContent = card.suit;

    const center = document.createElement("div");
    center.className = "big";
    center.textContent = card.rank;

    const bottom = document.createElement("div");
    bottom.className = "value";
    bottom.textContent = card.suit;

    cardEl.append(top, center, bottom);
    return cardEl;
}

function render() {
    potEl.textContent = `${state.pot} монет в банке`;
    document.querySelectorAll(".seat").forEach((seat) => {
        const player = state.players.find((p) => p.id === seat.dataset.id);
        seat.querySelector(".bank").textContent = `${player.bank} монет`;
        const status = seat.querySelector(".status");
        status.textContent = player.folded ? "Пас" : player.bet ? `Ставка ${player.bet}` : "В игре";
        status.className = "status " + (player.folded ? "folded" : "active");

        const cardsEl = seat.querySelector(".cards");
        cardsEl.innerHTML = "";
        const hide = player.isBot && state.phase !== "showdown";
        player.hand.forEach((card) => cardsEl.append(renderCard(card, hide)));

        const note = seat.querySelector(".note");
        note.textContent = player.log.slice(-1)[0] || "";
    });

    betButton.disabled = state.phase !== "bet";
    passButton.disabled = state.phase !== "bet";
    showdownButton.disabled = state.phase !== "bet" && state.phase !== "showdown";
    betSlider.disabled = state.phase !== "bet";

    document.querySelector("#message").textContent = state.message;
    updateBetValue();
}

function evaluateHand(hand) {
    const values = hand.map((c) => c.value).sort((a, b) => b - a);
    const suitsSet = new Set(hand.map((c) => c.suit));
    const isFlush = suitsSet.size === 1;

    const sortedRanks = hand
        .map((c) => ranks.indexOf(c.rank))
        .sort((a, b) => a - b);
    const isStraight = sortedRanks[2] - sortedRanks[0] === 2 && new Set(sortedRanks).size === 3;

    const counts = hand.reduce((acc, card) => {
        acc[card.rank] = (acc[card.rank] || 0) + 1;
        return acc;
    }, {});

    const pairRank = Object.keys(counts).find((r) => counts[r] === 2);
    const tripleRank = Object.keys(counts).find((r) => counts[r] === 3);

    const highCardScore = values[0] * 15 * 15 + values[1] * 15 + values[2];

    if (isStraight && isFlush) return { score: 900 + highCardScore, label: "Стрит-флэш" };
    if (tripleRank) return { score: 800 + rankValues[tripleRank], label: "Сет" };
    if (isStraight) return { score: 700 + highCardScore, label: "Стрит" };
    if (isFlush) return { score: 600 + highCardScore, label: "Флэш" };
    if (pairRank) return { score: 500 + rankValues[pairRank] * 15 + values.find((v) => v !== rankValues[pairRank]), label: "Пара" };
    return { score: 400 + highCardScore, label: "Старшая карта" };
}

function aiDecision(player) {
    const { score } = evaluateHand(player.hand);
    const desireToPlay = score - 400;
    const threshold = state.currentBet * 45;

    if (desireToPlay < threshold && Math.random() > 0.35) {
        player.folded = true;
        player.log.push("Пасует");
        return;
    }

    const callAmount = state.currentBet - player.bet;
    const canRaise = desireToPlay > 320 && player.bank > callAmount + 4 && Math.random() > 0.65;
    const raise = canRaise ? Math.min(player.bank, Math.ceil(state.currentBet + 3 + Math.random() * 4)) : state.currentBet;
    const toPay = Math.min(player.bank, raise - player.bet);
    const previousBet = player.bet;

    player.bet += toPay;
    player.bank -= toPay;
    state.pot += toPay;
    state.currentBet = Math.max(state.currentBet, player.bet);
    player.log.push(player.bet > previousBet ? `Рейз до ${player.bet}` : `Колл ${toPay}`);
}

function runBots() {
    state.players
        .filter((p) => p.isBot && !p.folded)
        .forEach(aiDecision);
}

function determineWinners() {
    const active = state.players.filter((p) => !p.folded);
    const scored = active.map((p) => ({ player: p, result: evaluateHand(p.hand) }));
    scored.sort((a, b) => b.result.score - a.result.score);
    const bestScore = scored[0].result.score;
    return scored.filter((s) => s.result.score === bestScore);
}

function addLog(message) {
    const li = document.createElement("li");
    li.textContent = message;
    logEl.prepend(li);
}

function startRound() {
    state.players.forEach((p) => {
        p.hand = [];
        p.folded = false;
        p.bet = 0;
        p.log = [];
    });
    ante();
    dealHands();
    state.phase = "bet";
    state.message = "Сделайте ставку или вскройте карты";
    addLog("Новый кон: все по 2 монеты в банк");
    render();
}

function playerBet() {
    const amount = Number(betSlider.value);
    const you = state.players[0];
    if (you.bank <= 0 || you.folded) return;

    const toPay = Math.min(you.bank, amount);
    you.bank -= toPay;
    you.bet += toPay;
    state.pot += toPay;
    state.currentBet = Math.max(state.currentBet, you.bet);
    you.log.push(`Ставит ${toPay}`);
    addLog(`Вы поставили ${toPay} монет`);
    runBots();
    state.message = "Боты ответили. Можно вскрываться";
    render();
}

function playerPass() {
    const you = state.players[0];
    you.folded = true;
    you.log.push("Пас");
    addLog("Вы спасовали");
    state.phase = "showdown";
    finishRound();
}

function finishRound() {
    const winners = determineWinners();
    const share = Math.floor(state.pot / winners.length);
    winners.forEach(({ player, result }) => {
        player.bank += share;
        player.log.push(`Берёт ${share}`);
        addLog(`${player.name} выигрывает (${result.label}) и забирает ${share}`);
    });
    if (state.pot % winners.length) addLog("Монета остаётся в банке для следующего кона");
    state.phase = "showdown";
    state.message = `Победа: ${winners.map((w) => w.player.name).join(", ")} (${winners[0].result.label})`;
    render();
}

betSlider.addEventListener("input", updateBetValue);
betButton.addEventListener("click", playerBet);
showdownButton.addEventListener("click", finishRound);
dealButton.addEventListener("click", startRound);
passButton.addEventListener("click", playerPass);

updateBetValue();
render();
