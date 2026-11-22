/**
 * LocalStorage 기반 루틴 저장/불러오기 및 기본 프리셋 관리
 */
(function (global) {
  const App = (global.PulseApp = global.PulseApp || {});

  const ROUTINES_KEY = 'workout_planner_routines_v1';
  const DRAFT_KEY = 'workout_planner_draft_v1';
  const AUDIO_MUTED_KEY = 'workout_planner_audio_muted_v1';

  function createStageId() {
    return `stg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  const DEFAULT_ROUTINES = [
    {
      id: 'preset_tabata_core',
      title: '전신 타바타 & 코어 루틴',
      prepSeconds: 5,
      updatedAt: '2026-11-23T00:00:00.000Z',
      stages: [
        {
          id: 'stg_preset_1',
          name: '점핑잭 (워밍업)',
          type: 'countdown',
          workSeconds: 30,
          restSeconds: 10,
          rounds: 2,
        },
        {
          id: 'stg_preset_2',
          name: '버피 테스트 타바타',
          type: 'tabata',
          workSeconds: 20,
          restSeconds: 10,
          rounds: 4,
        },
        {
          id: 'stg_preset_3',
          name: '플랭크 홀드',
          type: 'countdown',
          workSeconds: 45,
          restSeconds: 15,
          rounds: 2,
        },
      ],
    },
    {
      id: 'preset_hybrid_lap',
      title: '복합 인터벌 + 랩 타임 챌린지',
      prepSeconds: 5,
      updatedAt: '2026-11-23T00:00:00.000Z',
      stages: [
        {
          id: 'stg_preset_4',
          name: '스쿼트 20회 측정 (랩 타임)',
          type: 'countup',
          workSeconds: 0,
          restSeconds: 15,
          rounds: 2,
        },
        {
          id: 'stg_preset_5',
          name: '마운틴 클라이머',
          type: 'tabata',
          workSeconds: 20,
          restSeconds: 10,
          rounds: 4,
        },
        {
          id: 'stg_preset_6',
          name: '쿨다운 스트레칭',
          type: 'countdown',
          workSeconds: 40,
          restSeconds: 0,
          rounds: 1,
        },
      ],
    },
  ];

  function cloneData(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function getSavedRoutines() {
    try {
      const raw = localStorage.getItem(ROUTINES_KEY);
      if (!raw) {
        const seeded = cloneData(DEFAULT_ROUTINES);
        localStorage.setItem(ROUTINES_KEY, JSON.stringify(seeded));
        return seeded;
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return cloneData(DEFAULT_ROUTINES);
    }
  }

  function saveRoutine(title, prepSeconds, stages) {
    const cleanTitle = title.trim();
    const routines = getSavedRoutines();
    const existingIdx = routines.findIndex(
      (item) => item.title.toLowerCase() === cleanTitle.toLowerCase()
    );

    const record = {
      id: existingIdx >= 0 ? routines[existingIdx].id : `rtn_${Date.now()}`,
      title: cleanTitle,
      prepSeconds: Math.max(0, Number(prepSeconds) || 0),
      updatedAt: new Date().toISOString(),
      stages: cloneData(stages),
    };

    if (existingIdx >= 0) {
      routines[existingIdx] = record;
    } else {
      routines.unshift(record);
    }

    try {
      localStorage.setItem(ROUTINES_KEY, JSON.stringify(routines));
    } catch {
      // 스토리지 비활성 환경 무시
    }
    return { routines, updated: existingIdx >= 0, record };
  }

  function deleteRoutine(id) {
    const routines = getSavedRoutines().filter((item) => item.id !== id);
    try {
      localStorage.setItem(ROUTINES_KEY, JSON.stringify(routines));
    } catch {
      // 무시
    }
    return routines;
  }

  function getDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.stages)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveDraft(prepSeconds, stages) {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          prepSeconds: Math.max(0, Number(prepSeconds) || 0),
          stages,
        })
      );
    } catch {
      // 저장 공간 초과 시 조용히 무시
    }
  }

  function getAudioMuted() {
    try {
      return localStorage.getItem(AUDIO_MUTED_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function setAudioMuted(muted) {
    try {
      localStorage.setItem(AUDIO_MUTED_KEY, String(Boolean(muted)));
    } catch {
      // 무시
    }
  }

  App.storage = {
    DEFAULT_ROUTINES,
    createStageId,
    getSavedRoutines,
    saveRoutine,
    deleteRoutine,
    getDraft,
    saveDraft,
    getAudioMuted,
    setAudioMuted,
  };
})(window);
