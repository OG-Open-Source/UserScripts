const REGISTRY_ID = "userscript-registry";

const knownScripts = new Map();

export function readScripts() {
  const el = document.querySelector(`#${REGISTRY_ID}`);
  if (!el?.textContent) {
    return [];
  }
  try {
    const parsed = JSON.parse(el.textContent);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function collectScripts() {
  for (const s of readScripts()) {
    if (s?.id) {
      knownScripts.set(s.id, s);
    }
  }
  return Array.from(knownScripts.values());
}

export function hasScript(id) {
  return collectScripts().some((s) => s.id === id);
}

export function waitForScripts(ms = 1800) {
  return new Promise((resolve) => {
    let settleTimer = null;
    const finish = () => {
      clearTimeout(maxTimer);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      window.removeEventListener("userscript:presence", handlePresence);
      resolve(collectScripts());
    };
    const handlePresence = () => {
      collectScripts();
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      settleTimer = setTimeout(finish, 250);
    };
    const maxTimer = setTimeout(finish, ms);
    window.addEventListener("userscript:presence", handlePresence);
    if (collectScripts().length > 0) {
      handlePresence();
    }
  });
}

export function onPresence(callback) {
  window.addEventListener("userscript:presence", () =>
    callback(collectScripts())
  );
}

export function dispatchSettings(detail) {
  window.dispatchEvent(new CustomEvent("userscript:settings", { detail }));
}
