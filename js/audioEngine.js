/**
 * Web Audio API 기반 오디오 가이드 엔진
 * 외부 음원 파일 없이 예비음(삐, 삐, 삐), 전환음(삐이-), 완료음을 합성합니다.
 */
(function (global) {
  const App = (global.PulseApp = global.PulseApp || {});

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.muted = App.storage ? App.storage.getAudioMuted() : false;
    }

    /**
     * 사용자 클릭 등 제스처 이벤트 내부에서 호출하여 AudioContext를 활성화합니다.
     */
    unlock() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    isMuted() {
      return this.muted;
    }

    toggleMute() {
      this.muted = !this.muted;
      if (App.storage) {
        App.storage.setAudioMuted(this.muted);
      }
      if (!this.muted) {
        this.unlock();
        this._playTone(720, 0.08, 'sine', 0.2);
      }
      return this.muted;
    }

    /**
     * 3, 2, 1초 전 예비음 ('삐')
     */
    playWarningBeep() {
      if (this.muted) return;
      this._playTone(880, 0.13, 'triangle', 0.35);
    }

    /**
     * 구간 전환 / 종료음 ('삐이-')
     */
    playTransitionBeep() {
      if (this.muted) return;
      this._playTone(1320, 0.48, 'sine', 0.42);
    }

    /**
     * 전체 루틴 완료 팡파레
     */
    playCompleteFanfare() {
      if (this.muted) return;
      this.unlock();
      if (!this.ctx) return;

      const notes = [880, 1108.73, 1318.51, 1760];
      const now = this.ctx.currentTime;
      notes.forEach((freq, idx) => {
        const start = now + idx * 0.11;
        const duration = idx === notes.length - 1 ? 0.45 : 0.14;
        this._scheduleTone(freq, start, duration, 'triangle', 0.34);
      });
    }

    _playTone(freq, durationSec, type = 'sine', peakGain = 0.35) {
      this.unlock();
      if (!this.ctx) return;
      this._scheduleTone(freq, this.ctx.currentTime, durationSec, type, peakGain);
    }

    _scheduleTone(freq, startTime, durationSec, type, peakGain) {
      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.012);
        gain.gain.setValueAtTime(peakGain, startTime + Math.max(0.02, durationSec - 0.04));
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + durationSec + 0.02);
      } catch {
        // 오디오 컨텍스트 제한 환경에서도 타이머 실행은 유지
      }
    }
  }

  App.audioEngine = new AudioEngine();
})(window);
