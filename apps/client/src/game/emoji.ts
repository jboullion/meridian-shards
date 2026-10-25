// Ours (ADR 0024): the emoji the chat's picker offers. Any emoji can be typed or pasted (the OS
// emoji keyboard, a phone's keyboard); these are the ones a fantasy game's chat reaches for.
// Single code points or simple sequences only, so every system's emoji font draws them.

export const CHAT_EMOJI: readonly string[] = [
  // Faces
  "🙂", "😀", "😄", "😂", "🤣", "😉", "😊", "😍", "😎", "🤔", "😐", "🙄", "😏", "😮", "😱", "😢", "😭", "😡", "🤬", "😴", "🤢", "😇", "😈", "💀",
  // Hands and people
  "👍", "👎", "👋", "👏", "🙏", "💪", "🤝", "✌️", "👀", "🧙", "🧝", "🧛", "🧟", "👑",
  // Hearts and marks
  "❤️", "💔", "💯", "✨", "⭐", "❗", "❓", "💤", "💢", "💥", "🔥", "❄️", "⚡", "💧",
  // Things of the realm
  "⚔️", "🗡️", "🏹", "🛡️", "🪄", "🔮", "📜", "🧪", "💰", "💎", "🗝️", "🍺", "🍖", "🍎", "🌿", "🍄", "🐉", "🐺", "🕷️", "🦇", "🐀", "🐍", "🏰", "⚰️",
  // Sky
  "☀️", "🌙", "⛈️", "🌧️", "🌈",
];
