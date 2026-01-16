// Pricing module for LibreChat models
// Extracted from ../api/models/tx.js to work in Docker container

const defaultRate = 6;

/**
 * Mapping of model token sizes to their respective multipliers for prompt and completion.
 * The rates are 1 USD per 1M tokens.
 */
const tokenValues = {
  // Legacy token size mappings
  '8k': { prompt: 30, completion: 60 },
  '32k': { prompt: 60, completion: 120 },
  '4k': { prompt: 1.5, completion: 2 },
  '16k': { prompt: 3, completion: 4 },
  
  // Generic fallback patterns
  'claude-': { prompt: 0.8, completion: 2.4 },
  deepseek: { prompt: 0.28, completion: 0.42 },
  command: { prompt: 0.38, completion: 0.38 },
  gemma: { prompt: 0.02, completion: 0.04 },
  gemini: { prompt: 0.5, completion: 1.5 },
  'gpt-oss': { prompt: 0.05, completion: 0.2 },
  
  // Specific GPT models
  'gpt-3.5-turbo-1106': { prompt: 1, completion: 2 },
  'gpt-3.5-turbo-0125': { prompt: 0.5, completion: 1.5 },
  'gpt-4-1106': { prompt: 10, completion: 30 },
  'gpt-4.1': { prompt: 2, completion: 8 },
  'gpt-4.1-nano': { prompt: 0.1, completion: 0.4 },
  'gpt-4.1-mini': { prompt: 0.4, completion: 1.6 },
  'gpt-4.5': { prompt: 75, completion: 150 },
  'gpt-4o': { prompt: 2.5, completion: 10 },
  'gpt-4o-2024-05-13': { prompt: 5, completion: 15 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'gpt-5': { prompt: 1.25, completion: 10 },
  'gpt-5.1': { prompt: 1.25, completion: 10 },
  'gpt-5.2': { prompt: 1.75, completion: 14 },
  'gpt-5-nano': { prompt: 0.05, completion: 0.4 },
  'gpt-5-mini': { prompt: 0.25, completion: 2 },
  'gpt-5-pro': { prompt: 15, completion: 120 },
  o1: { prompt: 15, completion: 60 },
  'o1-mini': { prompt: 1.1, completion: 4.4 },
  'o1-preview': { prompt: 15, completion: 60 },
  o3: { prompt: 2, completion: 8 },
  'o3-mini': { prompt: 1.1, completion: 4.4 },
  'o4-mini': { prompt: 1.1, completion: 4.4 },
  
  // Claude models
  'claude-opus': { prompt: 15, completion: 75 },
  'claude-sonnet': { prompt: 3, completion: 15 },
  'claude-haiku': { prompt: 0.25, completion: 1.25 },
  'claude-3-opus': { prompt: 15, completion: 75 },
  'claude-3-sonnet': { prompt: 3, completion: 15 },
  'claude-3-haiku': { prompt: 0.25, completion: 1.25 },
  'claude-3-7-sonnet': { prompt: 3, completion: 15 },
  'claude-3.7-sonnet': { prompt: 3, completion: 15 },
  'claude-3-5-sonnet': { prompt: 3, completion: 15 },
  'claude-3.5-sonnet': { prompt: 3, completion: 15 },
  'claude-3-5-haiku': { prompt: 0.8, completion: 4 },
  'claude-3.5-haiku': { prompt: 0.8, completion: 4 },
  'claude-sonnet-4': { prompt: 3, completion: 15 },
  'claude-opus-4': { prompt: 15, completion: 75 },
  'claude-opus-4-5': { prompt: 5, completion: 25 },
  'claude-haiku-4-5': { prompt: 1, completion: 5 },
  
  // Gemini models
  'gemini-pro': { prompt: 0.5, completion: 1.5 },
  'gemini-1.5-pro': { prompt: 1.25, completion: 10 },
  'gemini-1.5-flash': { prompt: 0.075, completion: 0.6 },
  'gemini-2': { prompt: 0.5, completion: 1.5 },
  'gemini-2.0-flash': { prompt: 0.3, completion: 2.5 },
  'gemini-2.5': { prompt: 0.3, completion: 2.5 },
  'gemini-2.5-flash': { prompt: 0.3, completion: 2.5 },
  'gemini-2.5-flash-lite': { prompt: 0.1, completion: 0.4 },
  'gemini-2.5-pro': { prompt: 1.25, completion: 10 },
  'gemini-2.5-flash-image': { prompt: 0.15, completion: 30 },
  'gemini-3': { prompt: 2, completion: 12 },
  'gemini-3-pro-image': { prompt: 2, completion: 120 },
  'gemini-3-flash-preview': { prompt: 0.5, completion: 1.5 },
  'gemini-pro-vision': { prompt: 0.5, completion: 1.5 },
  
  // Grok models
  grok: { prompt: 2.0, completion: 10.0 },
  'grok-beta': { prompt: 5.0, completion: 15.0 },
  'grok-vision-beta': { prompt: 5.0, completion: 15.0 },
  'grok-2': { prompt: 2.0, completion: 10.0 },
  'grok-2-1212': { prompt: 2.0, completion: 10.0 },
  'grok-2-latest': { prompt: 2.0, completion: 10.0 },
  'grok-2-vision': { prompt: 2.0, completion: 10.0 },
  'grok-3': { prompt: 3.0, completion: 15.0 },
  'grok-3-fast': { prompt: 5.0, completion: 25.0 },
  'grok-3-mini': { prompt: 0.3, completion: 0.5 },
  'grok-4': { prompt: 3.0, completion: 15.0 },
  'grok-4-fast': { prompt: 0.2, completion: 0.5 },
  
  // Mistral models
  codestral: { prompt: 0.3, completion: 0.9 },
  'ministral-3b': { prompt: 0.04, completion: 0.04 },
  'ministral-8b': { prompt: 0.1, completion: 0.1 },
  'mistral-nemo': { prompt: 0.15, completion: 0.15 },
  'mistral-saba': { prompt: 0.2, completion: 0.6 },
  'pixtral-large': { prompt: 2.0, completion: 6.0 },
  'mistral-large': { prompt: 2.0, completion: 6.0 },
  'mixtral-8x22b': { prompt: 0.65, completion: 0.65 },
  
  // Other models
  kimi: { prompt: 0.14, completion: 2.49 },
};

/**
 * Find matching pattern in tokenValues for a given model name
 */
function findMatchingPattern(modelName, values = tokenValues) {
  if (!modelName || typeof modelName !== 'string') {
    return undefined;
  }

  const lowerModel = modelName.toLowerCase();
  
  // Try exact match first
  if (values[lowerModel]) {
    return lowerModel;
  }
  
  // Try pattern matching
  const keys = Object.keys(values);
  for (const key of keys) {
    if (lowerModel.includes(key.toLowerCase())) {
      return key;
    }
  }
  
  return undefined;
}

/**
 * Retrieves the key associated with a given model name.
 */
function getValueKey(model, endpoint) {
  if (!model || typeof model !== 'string') {
    return undefined;
  }

  const matchedKey = findMatchingPattern(model, tokenValues);
  if (matchedKey) {
    return matchedKey;
  }

  // Legacy token size mappings for older models
  const modelLower = model.toLowerCase();
  if (modelLower.includes('gpt-3.5-turbo-16k')) {
    return '16k';
  } else if (modelLower.includes('gpt-3.5')) {
    return '4k';
  } else if (modelLower.includes('gpt-4-vision')) {
    return 'gpt-4-1106';
  } else if (modelLower.includes('gpt-4-0125')) {
    return 'gpt-4-1106';
  } else if (modelLower.includes('gpt-4-turbo')) {
    return 'gpt-4-1106';
  } else if (modelLower.includes('gpt-4-32k')) {
    return '32k';
  } else if (modelLower.includes('gpt-4')) {
    return '8k';
  }

  return undefined;
}

/**
 * Retrieves the multiplier for a given value key and token type.
 */
function getMultiplier({ valueKey, tokenType, model, endpoint, endpointTokenConfig }) {
  if (endpointTokenConfig) {
    return endpointTokenConfig?.[model]?.[tokenType] ?? defaultRate;
  }

  if (valueKey && tokenType) {
    return tokenValues[valueKey]?.[tokenType] ?? defaultRate;
  }

  if (!tokenType || !model) {
    return 1;
  }

  valueKey = getValueKey(model, endpoint);
  if (!valueKey) {
    return defaultRate;
  }

  return tokenValues[valueKey]?.[tokenType] ?? defaultRate;
}

module.exports = {
  tokenValues,
  getValueKey,
  getMultiplier,
  defaultRate,
};
