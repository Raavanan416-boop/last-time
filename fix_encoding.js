/**
 * Fix double-encoded UTF-8 in script.js
 * UTF-8 bytes were misread as Windows-1252, then re-saved as UTF-8 (mojibake).
 * Fix: map each char back through CP1252 to recover original bytes, decode as UTF-8.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'script.js');
const text = fs.readFileSync(filePath, 'utf-8');

// CP1252 byte-to-unicode mapping for bytes 0x80-0x9F
const cp1252Map = {
  0x20AC: 0x80, // €
  0x201A: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201E: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02C6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8A, // Š
  0x2039: 0x8B, // ‹
  0x0152: 0x8C, // Œ
  0x017D: 0x8E, // Ž
  0x2018: 0x91, // '
  0x2019: 0x92, // '
  0x201C: 0x93, // "
  0x201D: 0x94, // "
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02DC: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9A, // š
  0x203A: 0x9B, // ›
  0x0153: 0x9C, // œ
  0x017E: 0x9E, // ž
  0x0178: 0x9F, // Ÿ
};

// Convert each character back to its CP1252 byte value
const bytes = [];
for (let i = 0; i < text.length; i++) {
  const code = text.charCodeAt(i);
  if (code < 0x80) {
    bytes.push(code); // ASCII - same in both
  } else if (code <= 0xFF && !(code >= 0x80 && code <= 0x9F)) {
    bytes.push(code); // Latin-1 range (0xA0-0xFF) - same byte value
  } else if (cp1252Map[code] !== undefined) {
    bytes.push(cp1252Map[code]); // CP1252 special chars (0x80-0x9F range)
  } else if (code >= 0x80 && code <= 0x9F) {
    bytes.push(code); // Control chars - use as-is
  } else {
    // Character not in CP1252 - encode as UTF-8 directly (keep as-is)
    const buf = Buffer.from(text[i], 'utf-8');
    for (const b of buf) bytes.push(b);
  }
}

// Decode the recovered bytes as UTF-8
const fixed = Buffer.from(bytes).toString('utf-8');

// Verify by checking a known broken string
if (text.includes('\u00e2\u009c\u0085') && !fixed.includes('\u00e2\u009c\u0085')) {
  console.log('SUCCESS: Mojibake patterns removed');
}

// Check for some expected emojis in the fixed output
const checks = ['🎉', '📋', '✅', '🔴', '🚫', '🎤', '🔇', '🔊'];
const found = checks.filter(e => fixed.includes(e));
console.log(`Found ${found.length}/${checks.length} expected emojis: ${found.join(' ')}`);

// Write the fixed file
fs.writeFileSync(filePath, fixed, 'utf-8');
console.log('File saved successfully!');

// Show sample fixed lines
const lines = fixed.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('joined the party') || line.includes('Streaming video') || 
      line.includes('Select a video') || line.includes('No Mic')) {
    console.log(`  Line ${idx+1}: ${line.trim().substring(0, 100)}`);
  }
});
