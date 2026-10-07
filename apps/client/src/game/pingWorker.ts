// Ticks every 5 s from a worker: timers in background tabs are throttled (to once a
// minute in Chrome), but worker timers aren't, and the server hangs up after 30 s
// without a message (blakserv/game.c GameProcessSessionTimer).
setInterval(() => postMessage("ping"), 5000);
