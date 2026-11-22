/**
 * UI 렌더링 및 포맷 유틸리티 모듈
 */
(function (global) {
  const App = (global.PulseApp = global.PulseApp || {});
  const { PHASES, STAGE_TYPES } = App;

  const TYPE_LABELS = {
    [STAGE_TYPES.COUNTDOWN]: 'COUNT DOWN',
    [STAGE_TYPES.TABATA]: 'TABATA',
    [STAGE_TYPES.COUNTUP]: 'LAP TIME',
  };

  const PHASE_LABELS = {
    [PHASES.IDLE]: '대기 중',
    [PHASES.PREP]: '준비 중 (대기)',
    [PHASES.WORK]: '운동 중 · WORK',
    [PHASES.REST]: '휴식 중 · REST',
    [PHASES.PAUSED]: '일시정지',
    [PHASES.COMPLETED]: '루틴 완료',
  };

  function formatTime(totalSeconds) {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;

    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${mm}:${ss}`;
    }
    return `${mm}:${ss}`;
  }

  function estimateTotalSeconds(stages, prepSeconds = 0) {
    if (!stages.length) return { totalSeconds: 0, hasManual: false };
    let total = Math.max(0, Number(prepSeconds) || 0);
    let hasManual = false;

    stages.forEach((stage, idx) => {
      const isLastStage = idx === stages.length - 1;
      const rounds = Math.max(1, Number(stage.rounds) || 1);
      const work = Math.max(0, Number(stage.workSeconds) || 0);
      const rest = Math.max(0, Number(stage.restSeconds) || 0);

      if (stage.type === STAGE_TYPES.COUNTUP) {
        hasManual = true;
      } else {
        total += work * rounds;
      }

      const restCount = isLastStage ? Math.max(0, rounds - 1) : rounds;
      total += rest * restCount;
    });

    return { totalSeconds: total, hasManual };
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderDisplay(snapshot) {
    const displayPanel = document.getElementById('display-panel');
    const phaseBadge = document.getElementById('phase-badge');
    const stageCounter = document.getElementById('stage-counter');
    const stageTypeBadge = document.getElementById('stage-type-badge');
    const stageNameEl = document.getElementById('current-stage-name');
    const roundDisplay = document.getElementById('round-display');
    const timerValue = document.getElementById('timer-value');
    const timerSubtext = document.getElementById('timer-subtext');
    const progressFill = document.getElementById('progress-bar-fill');
    const stageDots = document.getElementById('stage-dots');
    const nextText = document.getElementById('next-exercise-text');

    document.body.dataset.phase = snapshot.phase;
    displayPanel.dataset.phase = snapshot.phase;

    phaseBadge.textContent = PHASE_LABELS[snapshot.phase] || '대기 중';

    if (snapshot.totalStages === 0) {
      stageCounter.textContent = 'STAGE 0 / 0';
      stageTypeBadge.textContent = 'READY';
      stageNameEl.textContent = '운동 스테이지를 추가하세요';
      roundDisplay.textContent = 'ROUND 0 / 0';
      timerValue.textContent = '00:00';
      timerValue.classList.remove('is-countdown-warning');
      timerSubtext.textContent = '오른쪽(또는 아래)에서 [＋ 추가] 버튼으로 운동을 등록하세요.';
      progressFill.style.width = '0%';
      progressFill.classList.remove('is-indeterminate');
      stageDots.innerHTML = '';
      nextText.textContent = '등록된 운동 없음';
      return;
    }

    const stage = snapshot.currentStage;
    stageCounter.textContent = `STAGE ${snapshot.stageIndex + 1} / ${snapshot.totalStages}`;
    stageTypeBadge.textContent = stage ? TYPE_LABELS[stage.type] : 'READY';

    if (snapshot.phase === PHASES.PREP) {
      stageNameEl.textContent = '준비하세요!';
      roundDisplay.textContent = `곧 시작 · ${stage.name}`;
    } else if (snapshot.phase === PHASES.COMPLETED) {
      stageNameEl.textContent = '운동 완료! 수고하셨습니다';
      roundDisplay.textContent = `${snapshot.totalStages}개 스테이지 클리어`;
    } else if (snapshot.phase === PHASES.REST) {
      stageNameEl.textContent = `휴식 · ${stage.name}`;
      roundDisplay.textContent = `ROUND ${snapshot.round} / ${snapshot.totalRounds}`;
    } else {
      stageNameEl.textContent = stage ? stage.name : '운동 준비';
      roundDisplay.textContent = `ROUND ${snapshot.round} / ${snapshot.totalRounds}`;
    }

    timerValue.textContent = formatTime(snapshot.displaySeconds);
    timerValue.classList.toggle('is-countdown-warning', snapshot.isWarning);

    if (snapshot.phase === PHASES.IDLE) {
      timerSubtext.textContent =
        snapshot.prepSeconds > 0
          ? `시작 시 ${snapshot.prepSeconds}초 대기 후 1번 스테이지가 시작됩니다`
          : '시작 버튼을 누르면 1번 스테이지가 바로 시작됩니다';
    } else if (snapshot.phase === PHASES.PREP) {
      timerSubtext.textContent = '자세를 잡고 준비하세요 · 바로 시작하려면 [다음] 버튼';
    } else if (snapshot.phase === PHASES.PAUSED) {
      timerSubtext.textContent = '일시정지됨 · [재개] 또는 [다음] 버튼을 누르세요';
    } else if (snapshot.phase === PHASES.COMPLETED) {
      timerSubtext.textContent = '다시 진행하려면 [다시 시작] 또는 [초기화]를 누르세요';
    } else if (snapshot.isCountUp) {
      const lapHint =
        snapshot.lastLapMs !== null
          ? `직전 랩 기록 ${formatTime(snapshot.lastLapMs / 1000)} · `
          : '';
      timerSubtext.textContent = `${lapHint}현재 세트를 마치면 [다음] 버튼을 누르세요`;
    } else if (snapshot.phase === PHASES.REST) {
      const lapHint =
        snapshot.lastLapMs !== null
          ? `방금 랩 기록: ${formatTime(snapshot.lastLapMs / 1000)} · `
          : '';
      timerSubtext.textContent = `${lapHint}호흡을 가다듬고 다음 운동을 준비하세요`;
    } else {
      timerSubtext.textContent =
        snapshot.isWarning ? '곧 전환됩니다!' : '집중해서 끝까지 진행하세요!';
    }

    if (snapshot.isCountUp && snapshot.phase === PHASES.WORK) {
      progressFill.classList.add('is-indeterminate');
    } else {
      progressFill.classList.remove('is-indeterminate');
      progressFill.style.width = `${(snapshot.progress * 100).toFixed(1)}%`;
    }

    stageDots.innerHTML = snapshot.stages
      .map((_, idx) => {
        let cls = 'stage-dot';
        if (snapshot.phase === PHASES.COMPLETED || idx < snapshot.stageIndex) {
          cls += ' is-done';
        } else if (idx === snapshot.stageIndex && snapshot.phase !== PHASES.IDLE) {
          cls += ' is-active';
        }
        return `<span class="${cls}"></span>`;
      })
      .join('');

    nextText.textContent = snapshot.nextInfo.text;
  }

  function renderControls(snapshot) {
    const btnStart = document.getElementById('btn-start');
    const btnStartLabel = document.getElementById('btn-start-label');
    const btnPause = document.getElementById('btn-pause');
    const btnNext = document.getElementById('btn-next');
    const btnNextLabel = document.getElementById('btn-next-label');
    const btnReset = document.getElementById('btn-reset');
    const prepInput = document.getElementById('prep-seconds-input');
    const lockNotice = document.getElementById('builder-lock-notice');

    const hasStages = snapshot.totalStages > 0;
    const isRunning =
      snapshot.phase === PHASES.PREP ||
      snapshot.phase === PHASES.WORK ||
      snapshot.phase === PHASES.REST;
    const isPaused = snapshot.phase === PHASES.PAUSED;
    const isLocked = isRunning || isPaused;

    btnStart.disabled = !hasStages || isRunning;
    btnStartLabel.textContent = isPaused
      ? '재개'
      : snapshot.phase === PHASES.COMPLETED
        ? '다시 시작'
        : '시작';

    btnPause.disabled = !isRunning;
    btnNext.disabled = !isLocked;
    btnReset.disabled = snapshot.phase === PHASES.IDLE;

    if (snapshot.isCountUp) {
      btnNextLabel.textContent =
        snapshot.round < snapshot.totalRounds ? '랩 완료' : '다음 단계';
    } else {
      btnNextLabel.textContent = '다음';
    }

    prepInput.disabled = isLocked;
    lockNotice.hidden = !isLocked;
  }

  function renderRoutineSummary(stages, prepSeconds) {
    const summaryEl = document.getElementById('total-routine-info');
    const { totalSeconds, hasManual } = estimateTotalSeconds(stages, prepSeconds);
    const timeText = formatTime(totalSeconds);
    const manualSuffix = hasManual ? ' + 랩 타임' : '';
    summaryEl.textContent = `총 ${stages.length}단계 · 예상 ${timeText}${manualSuffix}`;
  }

  function renderStageList(stages, snapshot, handlers) {
    const container = document.getElementById('stage-list');
    const isLocked =
      snapshot.phase === PHASES.PREP ||
      snapshot.phase === PHASES.WORK ||
      snapshot.phase === PHASES.REST ||
      snapshot.phase === PHASES.PAUSED;

    if (stages.length === 0) {
      container.innerHTML =
        '<div class="empty-state">등록된 운동 스테이지가 없습니다.<br />상단의 <strong>＋ 추가</strong> 버튼을 눌러 새 운동 단계를 만들어 보세요.</div>';
      return;
    }

    container.innerHTML = stages
      .map((stage, idx) => {
        const isCurrent = isLocked && idx === snapshot.stageIndex;
        const isCountUp = stage.type === STAGE_TYPES.COUNTUP;
        const dis = isLocked ? 'disabled' : '';

        return `
          <article class="stage-item ${isCurrent ? 'is-current' : ''}" data-stage-id="${escapeHtml(stage.id)}">
            <div class="stage-item-header">
              <div class="stage-index-wrap">
                <span class="stage-num">${idx + 1}</span>
                <select class="stage-type-select" data-field="type" aria-label="스테이지 타입" ${dis}>
                  <option value="countdown" ${stage.type === 'countdown' ? 'selected' : ''}>시간제한 (Count Down)</option>
                  <option value="tabata" ${stage.type === 'tabata' ? 'selected' : ''}>타바타 (Work/Rest)</option>
                  <option value="countup" ${stage.type === 'countup' ? 'selected' : ''}>랩 타임 (Count Up)</option>
                </select>
              </div>
              <div class="stage-item-tools">
                <button class="mini-btn" type="button" data-action="up" title="위로 이동" ${isLocked || idx === 0 ? 'disabled' : ''}>▲</button>
                <button class="mini-btn" type="button" data-action="down" title="아래로 이동" ${isLocked || idx === stages.length - 1 ? 'disabled' : ''}>▼</button>
                <button class="mini-btn" type="button" data-action="dup" title="스테이지 복제" ${dis}>⧉</button>
                <button class="mini-btn btn-del" type="button" data-action="del" title="스테이지 삭제" ${dis}>✕</button>
              </div>
            </div>

            <div class="stage-fields">
              <input
                class="field-name"
                type="text"
                data-field="name"
                value="${escapeHtml(stage.name)}"
                placeholder="운동 이름 (예: 스쿼트, 플랭크)"
                maxlength="40"
                aria-label="운동 이름"
                ${dis}
              />
              <div class="stage-numbers-row">
                <div class="num-field">
                  <label>운동 시간(초)</label>
                  ${
                    isCountUp
                      ? '<div class="manual-badge">수동 (다음 버튼)</div>'
                      : `<input type="number" min="1" max="3600" inputmode="numeric" data-field="workSeconds" value="${stage.workSeconds}" ${dis} />`
                  }
                </div>
                <div class="num-field">
                  <label>휴식 시간(초)</label>
                  <input type="number" min="0" max="600" inputmode="numeric" data-field="restSeconds" value="${stage.restSeconds}" ${dis} />
                </div>
                <div class="num-field">
                  <label>라운드 수</label>
                  <input type="number" min="1" max="99" inputmode="numeric" data-field="rounds" value="${stage.rounds}" ${dis} />
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join('');

    container.querySelectorAll('.stage-item').forEach((card) => {
      const id = card.dataset.stageId;

      card.querySelectorAll('[data-field]').forEach((el) => {
        const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(eventName, (e) => {
          handlers.onChangeField(id, el.dataset.field, e.target.value);
        });
      });

      card.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          handlers.onAction(id, btn.dataset.action);
        });
      });
    });
  }

  function syncStageActiveHighlight(stageIndex, isLocked) {
    const items = document.querySelectorAll('#stage-list .stage-item');
    items.forEach((el, idx) => {
      el.classList.toggle('is-current', isLocked && idx === stageIndex);
    });
  }

  function renderRoutineList(routines, handlers) {
    const container = document.getElementById('routine-list');

    if (!routines.length) {
      container.innerHTML =
        '<div class="empty-state">저장된 루틴이 없습니다. 위에서 루틴 이름을 입력해 저장해 보세요.</div>';
      return;
    }

    container.innerHTML = routines
      .map((routine) => {
        const { totalSeconds, hasManual } = estimateTotalSeconds(
          routine.stages,
          routine.prepSeconds
        );
        const timeLabel = formatTime(totalSeconds) + (hasManual ? '+' : '');
        return `
          <div class="routine-item" data-routine-id="${escapeHtml(routine.id)}">
            <div class="routine-info">
              <div class="routine-title">${escapeHtml(routine.title)}</div>
              <div class="routine-meta">${routine.stages.length}단계 · 대기 ${routine.prepSeconds}초 · 예상 ${timeLabel}</div>
            </div>
            <div class="routine-actions">
              <button class="btn-load" type="button" data-action="load">불러오기</button>
              <button class="mini-btn btn-del" type="button" data-action="delete" title="루틴 삭제">✕</button>
            </div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('.routine-item').forEach((row) => {
      const id = row.dataset.routineId;
      row.querySelector('[data-action="load"]').addEventListener('click', () => {
        handlers.onLoad(id);
      });
      row.querySelector('[data-action="delete"]').addEventListener('click', () => {
        handlers.onDelete(id);
      });
    });
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast is-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      window.setTimeout(() => toast.remove(), 260);
    }, 2400);
  }

  App.ui = {
    TYPE_LABELS,
    PHASE_LABELS,
    formatTime,
    estimateTotalSeconds,
    renderDisplay,
    renderControls,
    renderRoutineSummary,
    renderStageList,
    syncStageActiveHighlight,
    renderRoutineList,
    showToast,
  };
})(window);
