const POSITIVE = /\b(yes|yep|yeah|thanks|thank you|thank you so much|great|perfect|awesome|helpful|solved|sorted|works|working|excellent|exactly|good|brilliant|wonderful|that'?s all|nothing else|all good|all set|no more questions|no more|that'?s it|that helped|you helped)\b/i;
const NEGATIVE = /\b(no|nope|not really|still|doesn'?t|don'?t|isn'?t|not working|not solved|not helpful|still broken|frustrated|useless|terrible|didn'?t help|not fixed|not resolved)\b/i;

function detectSatisfaction(text) {
  const norm = text.toLowerCase();
  const hasPos = POSITIVE.test(norm);
  const hasNeg = NEGATIVE.test(norm);
  if (hasPos && !hasNeg) return 'positive';
  if (hasNeg && !hasPos) return 'negative';
  return 'unclear';
}

const phrases = [
  "no more questions",
  "that's all",
  "no",
  "not solved",
  "thanks"
];

phrases.forEach(p => {
  console.log(\`Phrase: "\${p}" -> Result: \${detectSatisfaction(p)}\`);
});
