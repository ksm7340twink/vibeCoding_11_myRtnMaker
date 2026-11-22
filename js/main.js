/**
 * 앱 진입점 — 상태 관리, 스테이지 추가 모달, 모듈 연결, 단축키 및 Screen Wake Lock 관리
 */
(function (global) {
  const App = global.PulseApp;
  const { audioEngine, storage, PHASES, STAGE_TYPES, TimerEngine, ui } = App;

  let stages = [];
  let prepSeconds = 5;
  let savedRoutines = [];
  let lastLockedState = false;
  let wakeLockSentinel = null;

  // =========================================================================
  // Screen Wake Lock (모바일에서 운동 중 화면 꺼짐 방지)
  // =========================================================================
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      if (!wakeLockSentinel) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      }
    } catch {
      // 권한 제한 시 무시
    }
  }

  async function releaseWakeLock() {
    if (wakeLockSentinel) {
      try {
        await wakeLockSentinel.release();
      } catch {
        // 무시
      }
      wakeLockSentinel = null;
    }
  }

  // =========================================================================
  // 타이머 엔진 생성
  // =========================================================================
  const timer = new TimerEngine({
    audioEngine,
    onUpdate: (snapshot) => {
      ui.renderDisplay(snapshot);
      ui.renderControls(snapshot);

      const isLocked =
        snapshot.phase === PHASES.PREP ||
        snapshot.phase === PHASES.WORK ||
        snapshot.phase === PHASES.REST ||
        snapshot.phase === PHASES.PAUSED;

      if (isLocked !== lastLockedState) {
        lastLockedState = isLocked;
        refreshStageList();
      } else {
        ui.syncStageActiveHighlight(snapshot.stageIndex, isLocked);
      }

      if (
        snapshot.phase === PHASES.PREP ||
        snapshot.phase === PHASES.WORK ||
        snapshot.phase === PHASES.REST
      ) {
        requestWakeLock();
      } else {
        releaseWakeLock();
      }
    },
    onComplete: () => {
      ui.showToast('🎉 전체 운동 루틴을 완료했습니다!', 'success');
    },
    onLapRecord: ({ stageName, round, elapsedMs }) => {
      ui.showToast(`⏱ ${stageName} ${round}R 기록: ${ui.formatTime(elapsedMs / 1000)}`, 'info');
    },
  });

  // =========================================================================
  // 스테이지 추가 모달 제어
  // =========================================================================
  const modalEl = document.getElementById('stage-modal');
  const modalForm = document.getElementById('stage-modal-form');
  const modalTypeHidden = document.getElementById('modal-stage-type');
  const modalNameInput = document.getElementById('modal-stage-name');
  const modalWorkInput = document.getElementById('modal-work-seconds');
  const modalWorkManual = document.getElementById('modal-work-manual');
  const modalRestInput = document.getElementById('modal-rest-seconds');
  const modalRoundsInput = document.getElementById('modal-rounds');
  const modalTypeCards = document.querySelectorAll('[data-modal-type]');

  function applyModalType(type, applyPresetValues = true) {
    modalTypeHidden.value = type;

    modalTypeCards.forEach((card) => {
      const selected = card.dataset.modalType === type;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-checked', String(selected));
    });

    const isCountUp = type === STAGE_TYPES.COUNTUP;
    modalWorkInput.hidden = isCountUp;
    modalWorkInput.disabled = isCountUp;
    modalWorkManual.hidden = !isCountUp;

    if (applyPresetValues) {
      if (type === STAGE_TYPES.TABATA) {
        modalWorkInput.value = 20;
        modalRestInput.value = 10;
        modalRoundsInput.value = 8;
      } else if (type === STAGE_TYPES.COUNTUP) {
        modalRestInput.value = 15;
        modalRoundsInput.value = 1;
      } else {
        modalWorkInput.value = 30;
        modalRestInput.value = 10;
        modalRoundsInput.value = 3;
      }
    }
  }

  function openAddStageModal() {
    applyModalType(STAGE_TYPES.COUNTDOWN, true);
    modalNameInput.value = '';
    modalEl.hidden = false;
    document.body.classList.add('modal-open');
    window.setTimeout(() => modalNameInput.focus(), 30);
  }

  function closeAddStageModal() {
    modalEl.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function bindModalEvents() {
    modalTypeCards.forEach((card) => {
      card.addEventListener('click', () => {
        applyModalType(card.dataset.modalType, true);
      });
    });

    document.getElementById('btn-modal-close').addEventListener('click', closeAddStageModal);
    document.getElementById('btn-modal-cancel').addEventListener('click', closeAddStageModal);

    // 모달 바깥 배경 클릭 시 닫기
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) {
        closeAddStageModal();
      }
    });

    // 폼 제출 시 새 스테이지 추가
    modalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const type = modalTypeHidden.value;
      const idx = stages.length + 1;
      const defaultName =
        type === STAGE_TYPES.TABATA
          ? `타바타 운동 ${idx}`
          : type === STAGE_TYPES.COUNTUP
            ? `랩 타임 측정 ${idx}`
            : `운동 단계 ${idx}`;

      const name = modalNameInput.value.trim() || defaultName;
      const workVal = parseInt(modalWorkInput.value, 10);
      const restVal = parseInt(modalRestInput.value, 10);
      const roundsVal = parseInt(modalRoundsInput.value, 10);

      const newStage = {
        id: storage.createStageId(),
        name,
        type,
        workSeconds:
          type === STAGE_TYPES.COUNTUP
            ? 0
            : Number.isNaN(workVal)
              ? 30
              : Math.min(3600, Math.max(1, workVal)),
        restSeconds: Number.isNaN(restVal) ? 0 : Math.min(600, Math.max(0, restVal)),
        rounds: Number.isNaN(roundsVal) ? 1 : Math.min(99, Math.max(1, roundsVal)),
      };

      stages.push(newStage);
      closeAddStageModal();
      persistAndSync(true);
      ui.showToast(`'${newStage.name}' 스테이지를 추가했습니다.`, 'success');

      const list = document.getElementById('stage-list');
      if (list.lastElementChild) {
        list.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  // =========================================================================
  // 상태 동기화 & 목록 렌더링
  // =========================================================================
  function persistAndSync(reRenderStages = true) {
    storage.saveDraft(prepSeconds, stages);
    timer.configure(stages, prepSeconds);
    ui.renderRoutineSummary(stages, prepSeconds);
    if (reRenderStages) {
      refreshStageList();
    }
  }

  function refreshStageList() {
    ui.renderStageList(stages, timer.getSnapshot(), {
      onChangeField: (id, field, rawValue) => {
        const target = stages.find((s) => s.id === id);
        if (!target) return;

        if (field === 'type') {
          target.type = rawValue;
          if (rawValue === STAGE_TYPES.TABATA && target.workSeconds <= 0) {
            target.workSeconds = 20;
            target.restSeconds = 10;
            target.rounds = 8;
          } else if (rawValue === STAGE_TYPES.COUNTDOWN && target.workSeconds <= 0) {
            target.workSeconds = 30;
          }
          persistAndSync(true);
          return;
        }

        if (field === 'name') {
          target.name = rawValue;
          persistAndSync(false);
          return;
        }

        const num = parseInt(rawValue, 10);
        if (field === 'workSeconds') {
          target.workSeconds = Number.isNaN(num) ? 1 : Math.min(3600, Math.max(1, num));
        } else if (field === 'restSeconds') {
          target.restSeconds = Number.isNaN(num) ? 0 : Math.min(600, Math.max(0, num));
        } else if (field === 'rounds') {
          target.rounds = Number.isNaN(num) ? 1 : Math.min(99, Math.max(1, num));
        }

        persistAndSync(false);
      },
      onAction: (id, action) => {
        const idx = stages.findIndex((s) => s.id === id);
        if (idx < 0) return;

        if (action === 'up' && idx > 0) {
          [stages[idx - 1], stages[idx]] = [stages[idx], stages[idx - 1]];
        } else if (action === 'down' && idx < stages.length - 1) {
          [stages[idx], stages[idx + 1]] = [stages[idx + 1], stages[idx]];
        } else if (action === 'dup') {
          const copy = {
            ...stages[idx],
            id: storage.createStageId(),
            name: `${stages[idx].name} (복사)`,
          };
          stages.splice(idx + 1, 0, copy);
        } else if (action === 'del') {
          stages.splice(idx, 1);
        }

        persistAndSync(true);
      },
    });
  }

  function refreshRoutineList() {
    ui.renderRoutineList(savedRoutines, {
      onLoad: (id) => {
        const found = savedRoutines.find((r) => r.id === id);
        if (!found) return;

        if (timer.isRunningOrPaused()) {
          timer.reset();
        }

        prepSeconds = found.prepSeconds;
        stages = found.stages.map((s) => ({ ...s, id: storage.createStageId() }));
        document.getElementById('prep-seconds-input').value = prepSeconds;
        document.getElementById('routine-name-input').value = found.title;

        persistAndSync(true);
        ui.showToast(`'${found.title}' 루틴을 불러왔습니다.`, 'success');
      },
      onDelete: (id) => {
        const found = savedRoutines.find((r) => r.id === id);
        savedRoutines = storage.deleteRoutine(id);
        refreshRoutineList();
        if (found) {
          ui.showToast(`'${found.title}' 루틴을 삭제했습니다.`, 'info');
        }
      },
    });
  }

  function updateSoundButtonUI() {
    const btn = document.getElementById('btn-sound-toggle');
    const icon = document.getElementById('sound-icon');
    const label = document.getElementById('sound-label');
    const muted = audioEngine.isMuted();

    btn.setAttribute('aria-pressed', String(muted));
    icon.textContent = muted ? '🔇' : '🔊';
    label.textContent = muted ? '사운드 OFF' : '사운드 ON';
  }

  function bindEvents() {
    // 타이머 컨트롤 버튼
    document.getElementById('btn-start').addEventListener('click', () => {
      if (stages.length === 0) {
        ui.showToast('먼저 운동 스테이지를 1개 이상 추가하세요.', 'error');
        return;
      }
      stages.forEach((s, idx) => {
        if (!s.name.trim()) s.name = `운동 단계 ${idx + 1}`;
      });
      timer.configure(stages, prepSeconds);
      timer.start();
    });

    document.getElementById('btn-pause').addEventListener('click', () => {
      timer.pause();
    });

    document.getElementById('btn-next').addEventListener('click', () => {
      timer.next();
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
      timer.reset();
      ui.showToast('타이머를 초기화했습니다.', 'info');
    });

    // 대기 시간 입력
    document.getElementById('prep-seconds-input').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      prepSeconds = Number.isNaN(val) ? 0 : Math.min(60, Math.max(0, val));
      persistAndSync(false);
    });

    // '＋ 추가' 버튼 클릭 → 스테이지 추가 모달 열기
    document.getElementById('btn-add-stage').addEventListener('click', () => {
      openAddStageModal();
    });

    // 루틴 저장
    document.getElementById('btn-save-routine').addEventListener('click', () => {
      const input = document.getElementById('routine-name-input');
      const title = input.value.trim();

      if (!title) {
        ui.showToast('저장할 루틴 이름을 입력해 주세요.', 'error');
        input.focus();
        return;
      }
      if (stages.length === 0) {
        ui.showToast('저장할 운동 스테이지를 1개 이상 추가해 주세요.', 'error');
        return;
      }

      const { routines, updated } = storage.saveRoutine(title, prepSeconds, stages);
      savedRoutines = routines;
      refreshRoutineList();
      ui.showToast(
        updated ? `'${title}' 루틴을 업데이트했습니다.` : `'${title}' 루틴을 저장했습니다.`,
        'success'
      );
    });

    // 사운드 토글
    document.getElementById('btn-sound-toggle').addEventListener('click', () => {
      audioEngine.toggleMute();
      updateSoundButtonUI();
    });

    // 집중 모드 토글
    document.getElementById('btn-focus-toggle').addEventListener('click', (e) => {
      const isFocus = document.body.classList.toggle('focus-mode');
      const btn = e.currentTarget;
      btn.setAttribute('aria-pressed', String(isFocus));
      document.getElementById('focus-label').textContent = isFocus ? '편집 보기' : '집중 모드';
    });

    // 키보드 단축키 (ESC로 모달 닫기 + Space/ArrowRight/R 타이머 제어)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modalEl.hidden) {
        e.preventDefault();
        closeAddStageModal();
        return;
      }

      if (!modalEl.hidden) return;

      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        const { phase } = timer.getSnapshot();
        if (phase === PHASES.WORK || phase === PHASES.REST || phase === PHASES.PREP) {
          timer.pause();
        } else if (stages.length > 0) {
          timer.start();
        }
      } else if (e.code === 'ArrowRight' && timer.isRunningOrPaused()) {
        e.preventDefault();
        timer.next();
      } else if (e.key.toLowerCase() === 'r' && timer.getSnapshot().phase !== PHASES.IDLE) {
        e.preventDefault();
        timer.reset();
      }
    });

    document.addEventListener('visibilitychange', () => {
      const { phase } = timer.getSnapshot();
      if (
        document.visibilityState === 'visible' &&
        (phase === PHASES.PREP || phase === PHASES.WORK || phase === PHASES.REST)
      ) {
        requestWakeLock();
      }
    });
  }

  function init() {
    savedRoutines = storage.getSavedRoutines();
    const draft = storage.getDraft();

    if (draft && draft.stages.length > 0) {
      prepSeconds = draft.prepSeconds;
      stages = draft.stages;
    } else if (savedRoutines.length > 0) {
      prepSeconds = savedRoutines[0].prepSeconds;
      stages = savedRoutines[0].stages.map((s) => ({ ...s, id: storage.createStageId() }));
      document.getElementById('routine-name-input').value = savedRoutines[0].title;
    }

    document.getElementById('prep-seconds-input').value = prepSeconds;

    updateSoundButtonUI();
    bindModalEvents();
    bindEvents();
    refreshRoutineList();
    persistAndSync(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
