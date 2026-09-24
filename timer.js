// Screen-time counter. Kept free of Electron so test.js can run it with plain node.
const LIMIT = Number(process.env.BUDDY_LIMIT) || 3600; // seconds of screen time before a reminder
const BREAK = 300; // this much idle time counts as a real break and resets the counter

const tick = (activeSec, idleSec) => (idleSec >= BREAK ? 0 : activeSec + 1);

module.exports = { tick, LIMIT, BREAK };
