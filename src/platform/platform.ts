// Platform helpers: storage persistence, standalone detection, speech, file save (architecture §4).

export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageStatus(): Promise<{ persisted: boolean | null; usage?: number; quota?: number }> {
  try {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
    return { persisted, usage: est.usage, quota: est.quota };
  } catch {
    return { persisted: null };
  }
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

// ---------- speech ----------

export function englishVoices(): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
}

export function pickVoice(preferredURI: string | null): SpeechSynthesisVoice | null {
  const voices = englishVoices();
  return voices.find((v) => v.voiceURI === preferredURI) ?? voices.find((v) => v.lang === "en-GB") ?? voices[0] ?? null;
}

export function speak(text: string, preferredURI: string | null): boolean {
  const voice = pickVoice(preferredURI);
  if (!voice) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.95;
  speechSynthesis.speak(u);
  return true;
}

// ---------- files ----------

/** Saves a file via the share sheet when possible, otherwise via a download link (spike S2). */
export async function saveFile(name: string, text: string, type = "application/json"): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([text], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: name });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
