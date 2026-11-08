    toolService.register(defineTool({
      name: 'anima_state_get',
      description: '读取 anima 当前 runtime 状态（说话门、在场、心情、日程等）；需要查看或排查她此刻状态时使用。',
      parameters: {},
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute() {
        return summarizeRuntime(state.runtime, nowIso()) + '\n\n' + JSON.stringify(state.runtime, null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_presence_move',
      description: '设置 anima 当前所在房间和活动；需要让她移动、换房间或记录所在位置时使用。',
      parameters: {
        room: { type: 'string', required: true, description: '要移动到的房间' },
        activity: { type: 'string', description: '当前活动，如看书、工作；省略则不指定' },
        minutes: { type: 'number', description: '预计停留分钟数；省略表示不设时限' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          state.runtime = applyRuntimeEvent(state.runtime, {
            type: 'move-to',
            room: args.room,
            activity: args.activity,
            minutes: args.minutes,
          }, nowIso())
          await persistRuntime()
          return describePresence(state.runtime.presence, nowIso())
        })
      },
    }))

    toolService.register(defineTool({
      name: 'anima_mood_note',
      description: '记录一条会影响 anima 心情的消息或事件；需要根据对话、反馈或事件更新她心情时使用。',
      parameters: {
        text: { type: 'string', required: true, description: '要记录的消息或事件文本' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          state.runtime = applyRuntimeEvent(state.runtime, { type: 'message', text: args.text }, nowIso())
          await persistRuntime()
          return describeMood(state.runtime.mood)
        })
      },
    }))

    toolService.register(defineTool({
      name: 'anima_quiet',
      description: '控制 anima 的安静/说话门状态；需要晚安、早安、临时覆盖或抑制她说话时使用。',
      parameters: {
        action: { type: 'string', required: true, description: '动作：goodnight/goodmorning/override/suppressed' },
        minutes: { type: 'number', description: '安静或覆盖持续分钟数；省略表示按默认' },
        text: { type: 'string', description: '附带的说明文本' },
        kind: { type: 'string', description: '安静/覆盖的类型标记' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          state.runtime = applyRuntimeEvent(state.runtime, {
            type: args.action,
            minutes: args.minutes,
            text: args.text,
            kind: args.kind,
          }, nowIso())
          await persistRuntime()
          return String(summarizeRuntime(state.runtime, nowIso())).split('\n').find(function (line) {
            return line.startsWith('- 说话门：')
          }) || '说话门：未知'
        })
      },
    }))
