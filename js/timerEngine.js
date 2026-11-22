/**
 * 운동 시퀀스 실행 타이머 엔진
 * - 대기 시간(PREP), 운동(WORK), 휴식(REST), 일시정지(PAUSED), 완료(COMPLETED) 상태 머신
 * - Count Down / Tabata / Count Up(Lap Time) 3종 스테이지 지원
 * - '다음' 버튼으로 다음 스테이지(또는 랩 타임 라운드) 전환
 * - performance.now() 델타 기반 고정밀 타이머 및 3·2·1초 예비음 + 전환음 트리거
 */
(function (global) {
  const App = (global.PulseApp = global.PulseApp || {});

  const PHASES = {
    IDLE: 'idle',
    PREP: 'prep',
    WORK: 'work',
    REST: 'rest',
    PAUSED: 'paused',
    COMPLETED: 'completed',
  };

  const STAGE_TYPES = {
    COUNTDOWN: 'countdown',
    TABATA: 'tabata',
    COUNTUP: 'countup',
  };

  class TimerEngine {
    constructor({ audioEngine, onUpdate, onComplete, onLapRecord }) {
      this.audio = audioEngine;
      this.onUpdate = onUpdate || (() => {});
      this.onComplete = onComplete || (() => {});
      this.onLapRecord = onLapRecord || (() => {});

      this.stages = [];
      this.prepSeconds = 5;

      this.phase = PHASES.IDLE;
      this.pausedFromPhase = null;

      this.stageIndex = 0;
      this.round = 1;

      this.segmentDurationMs = 0;
      this.remainingMs = 0;
      this.elapsedMs = 0;
      this.lastLapMs = null;

      this.lastTickAt = 0;
      this.lastBeepSecond = null;
      this.intervalId = null;
    }

    /**
     * 스테이지 목록과 대기 시간을 반영합니다.
     * 실행/일시정지 중에도 뒤에 스테이지가 추가된 경우 안전하게 총 단계/Next 정보를 갱신합니다.
     */
    configure(stages, prepSeconds) {
      this.stages = stages;
      this.prepSeconds = Math.max(0, Math.floor(Number(prepSeconds) || 0));

      if (this.phase === PHASES.IDLE || this.phase === PHASES.COMPLETED) {
        this._syncIdlePreview();
      }
      this._emit();
    }

    isRunningOrPaused() {
      return (
        this.phase === PHASES.PREP ||
        this.phase === PHASES.WORK ||
        this.phase === PHASES.REST ||
        this.phase === PHASES.PAUSED
      );
    }

    /**
     * 루틴 시작 또는 일시정지 재개
     */
    start() {
      if (this.stages.length === 0) return false;
      this.audio.unlock();

      // 일시정지에서 재개
      if (this.phase === PHASES.PAUSED && this.pausedFromPhase) {
        this.phase = this.pausedFromPhase;
        this.pausedFromPhase = null;
        this._startTicker();
        this._emit();
        return true;
      }

      if (this.phase === PHASES.PREP || this.phase === PHASES.WORK || this.phase === PHASES.REST) {
        return false;
      }

      // 처음부터 시작
      this.stageIndex = 0;
      this.round = 1;
      this.lastLapMs = null;

      if (this.prepSeconds > 0) {
        this._enterPrep();
      } else {
        this.audio.playTransitionBeep();
        this._enterWork(0, 1);
      }

      this._startTicker();
      this._emit();
      return true;
    }

    /**
     * 일시정지
     */
    pause() {
      if (
        this.phase !== PHASES.PREP &&
        this.phase !== PHASES.WORK &&
        this.phase !== PHASES.REST
      ) {
        return;
      }
      this._stopTicker();
      this.pausedFromPhase = this.phase;
      this.phase = PHASES.PAUSED;
      this._emit();
    }

    /**
     * '다음' 버튼:
     * - PREP 중이면 대기 종료 후 1번 스테이지 즉시 시작
     * - Count Up(랩 타임) WORK 중이면 현재 랩 기록 후 다음 라운드(휴식 포함) 또는 다음 스테이지로 전환
     * - 그 외(일반 스테이지 WORK / REST)이면 다음 스테이지로 즉시 전환
     */
    next() {
      if (!this.isRunningOrPaused()) return;
      this.audio.unlock();

      const wasPaused = this.phase === PHASES.PAUSED;
      const activePhase = wasPaused ? this.pausedFromPhase : this.phase;
      this.pausedFromPhase = null;

      // 1. 대기 시간 중 '다음' → 1번 스테이지 즉시 시작
      if (activePhase === PHASES.PREP) {
        this.audio.playTransitionBeep();
        this._enterWork(0, 1);
        this._startTicker();
        this._emit();
        return;
      }

      const currentStage = this.stages[this.stageIndex];
      if (!currentStage) {
        this._finishRoutine();
        return;
      }

      // 2. 랩 타임(Count Up) WORK 중 '다음' → 랩 기록 후 라운드/휴식 또는 다음 스테이지 전환
      if (activePhase === PHASES.WORK && currentStage.type === STAGE_TYPES.COUNTUP) {
        this.lastLapMs = this.elapsedMs;
        this.onLapRecord({
          stageName: currentStage.name,
          round: this.round,
          elapsedMs: this.elapsedMs,
        });

        const isFinalStage = this.stageIndex >= this.stages.length - 1;
        const isFinalRound = this.round >= currentStage.rounds;

        if (isFinalStage && isFinalRound) {
          this._finishRoutine();
          return;
        }

        this.audio.playTransitionBeep();

        if (currentStage.restSeconds > 0) {
          this._enterRest(currentStage.restSeconds);
        } else if (!isFinalRound) {
          this._enterWork(this.stageIndex, this.round + 1);
        } else {
          this._enterWork(this.stageIndex + 1, 1);
        }

        this._startTicker();
        this._emit();
        return;
      }

      // 3. 일반 스테이지(Count Down / Tabata) 또는 REST 중 '다음' → 다음 스테이지로 즉시 이동
      const nextStageIdx = this.stageIndex + 1;
      if (nextStageIdx < this.stages.length) {
        this.audio.playTransitionBeep();
        this.lastLapMs = null;
        this._enterWork(nextStageIdx, 1);
        this._startTicker();
        this._emit();
      } else {
        this._finishRoutine();
      }
    }

    /**
     * 전체 루틴 초기화
     */
    reset() {
      this._stopTicker();
      this.phase = PHASES.IDLE;
      this.pausedFromPhase = null;
      this.stageIndex = 0;
      this.round = 1;
      this.lastLapMs = null;
      this.lastBeepSecond = null;
      this._syncIdlePreview();
      this._emit();
    }

    /**
     * UI 렌더링용 전체 상태 스냅샷 반환
     */
    getSnapshot() {
      const activePhase = this.phase === PHASES.PAUSED ? this.pausedFromPhase : this.phase;
      const currentStage = this.stages[this.stageIndex] || null;
      const nextInfo = this._computeNextInfo(activePhase);
      const isCountUp = Boolean(
        currentStage &&
          currentStage.type === STAGE_TYPES.COUNTUP &&
          activePhase === PHASES.WORK
      );

      let progress = 0;
      if (this.phase === PHASES.COMPLETED) {
        progress = 1;
      } else if (isCountUp) {
        progress = 0;
      } else if (this.segmentDurationMs > 0) {
        progress = Math.min(1, Math.max(0, 1 - this.remainingMs / this.segmentDurationMs));
      }

      const displaySeconds = isCountUp
        ? Math.floor(this.elapsedMs / 1000)
        : Math.ceil(this.remainingMs / 1000);

      const isWarning =
        !isCountUp &&
        (this.phase === PHASES.PREP || this.phase === PHASES.WORK || this.phase === PHASES.REST) &&
        displaySeconds >= 1 &&
        displaySeconds <= 3;

      return {
        phase: this.phase,
        activePhase,
        stages: this.stages,
        stageIndex: this.stageIndex,
        totalStages: this.stages.length,
        currentStage,
        round: this.round,
        totalRounds: currentStage ? currentStage.rounds : 0,
        prepSeconds: this.prepSeconds,
        isCountUp,
        remainingMs: this.remainingMs,
        elapsedMs: this.elapsedMs,
        displaySeconds,
        progress,
        isWarning,
        lastLapMs: this.lastLapMs,
        nextInfo,
      };
    }

    // =========================================================================
    // Internal State Transitions
    // =========================================================================

    _syncIdlePreview() {
      this.stageIndex = 0;
      this.round = 1;
      this.elapsedMs = 0;
      this.lastBeepSecond = null;

      if (this.stages.length === 0) {
        this.segmentDurationMs = 0;
        this.remainingMs = 0;
        return;
      }

      const first = this.stages[0];
      if (this.prepSeconds > 0) {
        this.segmentDurationMs = this.prepSeconds * 1000;
        this.remainingMs = this.segmentDurationMs;
      } else if (first.type === STAGE_TYPES.COUNTUP) {
        this.segmentDurationMs = 0;
        this.remainingMs = 0;
      } else {
        this.segmentDurationMs = first.workSeconds * 1000;
        this.remainingMs = this.segmentDurationMs;
      }
    }

    _enterPrep() {
      this.phase = PHASES.PREP;
      this.stageIndex = 0;
      this.round = 1;
      this.segmentDurationMs = this.prepSeconds * 1000;
      this.remainingMs = this.segmentDurationMs;
      this.elapsedMs = 0;
      this.lastBeepSecond = null;
    }

    _enterWork(stageIdx, roundNum) {
      const stage = this.stages[stageIdx];
      this.phase = PHASES.WORK;
      this.stageIndex = stageIdx;
      this.round = roundNum;
      this.lastBeepSecond = null;

      if (stage.type === STAGE_TYPES.COUNTUP) {
        this.segmentDurationMs = 0;
        this.remainingMs = 0;
        this.elapsedMs = 0;
      } else {
        this.segmentDurationMs = Math.max(1, stage.workSeconds) * 1000;
        this.remainingMs = this.segmentDurationMs;
        this.elapsedMs = 0;
      }
    }

    _enterRest(restSeconds) {
      this.phase = PHASES.REST;
      this.segmentDurationMs = Math.max(1, restSeconds) * 1000;
      this.remainingMs = this.segmentDurationMs;
      this.elapsedMs = 0;
      this.lastBeepSecond = null;
    }

    _finishRoutine() {
      this._stopTicker();
      this.phase = PHASES.COMPLETED;
      this.pausedFromPhase = null;
      this.remainingMs = 0;
      this.audio.playCompleteFanfare();
      this._emit();
      this.onComplete();
    }

    _startTicker() {
      this._stopTicker();
      this.lastTickAt = performance.now();
      this.intervalId = window.setInterval(() => this._tick(), 50);
    }

    _stopTicker() {
      if (this.intervalId !== null) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }

    _tick() {
      const now = performance.now();
      const delta = Math.max(0, now - this.lastTickAt);
      this.lastTickAt = now;

      const currentStage = this.stages[this.stageIndex];

      // Count Up (랩 타임) WORK 구간: 시간 증가
      if (
        this.phase === PHASES.WORK &&
        currentStage &&
        currentStage.type === STAGE_TYPES.COUNTUP
      ) {
        this.elapsedMs += delta;
        this._emit();
        return;
      }

      // 카운트다운 구간 (PREP / WORK / REST)
      this.remainingMs = Math.max(0, this.remainingMs - delta);

      const ceilSec = Math.ceil(this.remainingMs / 1000);
      if (ceilSec >= 1 && ceilSec <= 3 && ceilSec !== this.lastBeepSecond) {
        this.lastBeepSecond = ceilSec;
        this.audio.playWarningBeep();
      }

      if (this.remainingMs <= 0) {
        this._handleCountdownComplete();
      } else {
        this._emit();
      }
    }

    _handleCountdownComplete() {
      if (this.phase === PHASES.PREP) {
        this.audio.playTransitionBeep();
        this._enterWork(0, 1);
        this._emit();
        return;
      }

      const currentStage = this.stages[this.stageIndex];
      if (!currentStage) {
        this._finishRoutine();
        return;
      }

      if (this.phase === PHASES.WORK) {
        const isFinalStage = this.stageIndex >= this.stages.length - 1;
        const isFinalRound = this.round >= currentStage.rounds;

        if (isFinalStage && isFinalRound) {
          this._finishRoutine();
          return;
        }

        this.audio.playTransitionBeep();

        if (currentStage.restSeconds > 0) {
          this._enterRest(currentStage.restSeconds);
        } else if (!isFinalRound) {
          this._enterWork(this.stageIndex, this.round + 1);
        } else {
          this._enterWork(this.stageIndex + 1, 1);
        }
        this._emit();
        return;
      }

      if (this.phase === PHASES.REST) {
        const hasMoreRounds = this.round < currentStage.rounds;
        this.audio.playTransitionBeep();

        if (hasMoreRounds) {
          this._enterWork(this.stageIndex, this.round + 1);
        } else if (this.stageIndex + 1 < this.stages.length) {
          this.lastLapMs = null;
          this._enterWork(this.stageIndex + 1, 1);
        } else {
          this._finishRoutine();
          return;
        }
        this._emit();
      }
    }

    _computeNextInfo(activePhase) {
      if (this.stages.length === 0) {
        return { text: '운동 스테이지를 추가해 주세요' };
      }
      if (this.phase === PHASES.COMPLETED) {
        return { text: '모든 운동 루틴을 완료했습니다! 🎉' };
      }

      const current = this.stages[this.stageIndex];
      const nextStage = this.stages[this.stageIndex + 1] || null;

      if (this.phase === PHASES.IDLE || activePhase === PHASES.PREP) {
        const first = this.stages[0];
        const detail =
          first.type === STAGE_TYPES.COUNTUP
            ? `랩 타임 · ${first.rounds}R`
            : `${first.workSeconds}초 · ${first.rounds}R`;
        return { text: `1단계 시작: ${first.name} (${detail})` };
      }

      if (activePhase === PHASES.REST && current) {
        if (this.round < current.rounds) {
          return {
            text: `${current.name} (ROUND ${this.round + 1}/${current.rounds})`,
          };
        }
        if (nextStage) {
          return { text: this._formatStageSummary(nextStage) };
        }
        return { text: '루틴 완료' };
      }

      if (current && this.round < current.rounds) {
        const restNote = current.restSeconds > 0 ? `휴식 ${current.restSeconds}초 후 ` : '';
        const nextStageHint = nextStage ? ` · 다음 단계: ${nextStage.name}` : '';
        return {
          text: `${restNote}${current.name} ${this.round + 1}R${nextStageHint}`,
        };
      }

      if (nextStage) {
        return { text: this._formatStageSummary(nextStage) };
      }

      return { text: '루틴 완료 (마지막 구간)' };
    }

    _formatStageSummary(stage) {
      if (stage.type === STAGE_TYPES.COUNTUP) {
        return `${stage.name} (랩 타임 · 휴식 ${stage.restSeconds}초 · ${stage.rounds}R)`;
      }
      return `${stage.name} (운동 ${stage.workSeconds}초 · 휴식 ${stage.restSeconds}초 · ${stage.rounds}R)`;
    }

    _emit() {
      this.onUpdate(this.getSnapshot());
    }
  }

  App.PHASES = PHASES;
  App.STAGE_TYPES = STAGE_TYPES;
  App.TimerEngine = TimerEngine;
})(window);
