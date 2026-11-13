import * as cloud from './cloud.js';

function consentKey() {
  return `monetizeo:gemini-consent:${cloud.userId()}`;
}

export function hasAssistantConsent() {
  try { return localStorage.getItem(consentKey()) === 'yes'; } catch { return false; }
}

export function setAssistantConsent(allowed) {
  try {
    if (allowed) localStorage.setItem(consentKey(), 'yes');
    else localStorage.removeItem(consentKey());
  } catch { /* armazenamento local indisponível */ }
}
