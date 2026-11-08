  function refreshSync() {
    const pStamp = stampOf(personaPath())
    if (pStamp !== state.personaStamp) {
      state.personaStamp = pStamp
      state.persona = normalizeState(readJsonSync(personaPath(), null))
    }
    const mStamp = stampOf(memoryPath())
    if (mStamp !== state.memoryStamp) {
      state.memoryStamp = mStamp
      state.memory = normalizeMemory(readJsonSync(memoryPath(), null))
    }
    const sStamp = stampOf(settingsPath())
    if (sStamp !== state.settingsStamp) {
      state.settingsStamp = sStamp
      state.settings = normalizeSettings(readJsonSync(settingsPath(), null))
    }
    const rStamp = stampOf(runtimePath())
    if (rStamp !== state.runtimeStamp) {
      state.runtimeStamp = rStamp
      state.runtime = normalizeRuntime(readJsonSync(runtimePath(), null), nowIso())
    }
  }

  async function persistRuntime() {
    state.runtimeStamp = 'writing'
    await writeJson(runtimePath(), state.runtime)
    state.runtimeStamp = stampOf(runtimePath())
  }
