// Pre-generated Korean female KSS voice. This is feedback, never learner playback.
export function createFeedbackVoice() {
  let audio = null;
  return {
    stop() {
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
    },
    play(score) {
      this.stop();
      if (!window.Audio || !Number.isInteger(score) || score < 0 || score > 100) return;
      audio = new window.Audio(`/audio/feedback/${score}.wav?v=7-even-audio`);
      audio.volume = 1;
      void audio.play().catch(() => { /* Text feedback remains available when autoplay is blocked. */ });
    },
  };
}
