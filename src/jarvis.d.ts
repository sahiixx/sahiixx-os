// Minimal ambient types for the Web Speech API (no built-in TS types ship for
// webkitSpeechRecognition). Chrome/Edge only. Without this file `npm run check`
// fails on any SpeechRecognition reference in src/pages/Jarvis.tsx.

declare global {
  interface Window {
    webkitSpeechRecognition?: typeof SpeechRecognition;
    SpeechRecognition?: typeof SpeechRecognition;
  }
  // SpeechRecognition is a constructor (newable). We type it loosely as any
  // since the lib typings vary; Jarvis.tsx treats the instance as a typed handle.
  var SpeechRecognition: { new (): SpeechRecognitionLike };
  interface SpeechRecognitionLike {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    start(): void;
    stop(): void;
    abort(): void;
    onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
    onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
    onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => void) | null;
    onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionResultEventLike) => void) | null;
  }
  interface SpeechRecognitionErrorEventLike extends Event {
    error: string;
  }
  interface SpeechRecognitionResultEventLike extends Event {
    resultIndex: number;
    results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }>;
  }
}

export {};