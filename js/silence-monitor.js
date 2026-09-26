// A short pause does not end an utterance. The clock starts only after sound.
export function createSilenceDetector({ silenceMs = 2000, threshold = 0.012 } = {}) {
  let lastSound = null;
  return (rms, now) => {
    if (rms >= threshold) lastSound = now;
    return lastSound !== null && now - lastSound >= silenceMs;
  };
}

export async function monitorSilence(stream, onSilence, options = {}) {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error('Audio input monitoring is unavailable');
  const context = new Context();
  try {
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser); // Never connect microphone to speakers.
    const samples = new Float32Array(analyser.fftSize);
    const detect = createSilenceDetector(options);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true; clearInterval(timer); source.disconnect(); analyser.disconnect();
      void context.close();
    };
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      if (detect(rms, performance.now())) { dispose(); onSilence(); }
    }, 50);
    return dispose;
  } catch (error) { void context.close(); throw error; }
}
