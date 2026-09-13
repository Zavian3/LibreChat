const fs = require('fs');

const file = '/app/packages/api/dist/index.js';
const source = fs.readFileSync(file, 'utf8');
const marker =
  'const currentMaxTokens = (_a = updatedOptions.max_tokens) !== null && _a !== void 0 ? _a : updatedOptions.maxTokens;';
const legacyAssignment =
  "updatedOptions.thinking = Object.assign(Object.assign({}, updatedOptions.thinking), { type: 'enabled' });";

if (!source.includes(marker) || !source.includes(legacyAssignment)) {
  throw new Error('Unsupported LibreChat build: Anthropic thinking patch could not be applied.');
}

const updated = source
  .replace(
    marker,
    `${marker}
    // Claude Sonnet/Opus 4.6+ rejects legacy extended-thinking requests.
    const usesAdaptiveThinking = updatedOptions.model != null &&
        /claude-(?:sonnet|opus)-(?:4-[6-9]|[5-9])(?:[.-]|$)/.test(updatedOptions.model);`,
  )
  .replace(
    legacyAssignment,
    "updatedOptions.thinking = usesAdaptiveThinking ? { type: 'adaptive' } : Object.assign(Object.assign({}, updatedOptions.thinking), { type: 'enabled' });",
  );

fs.writeFileSync(file, updated);
