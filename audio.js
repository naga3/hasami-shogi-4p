/*
 * サウンド — Web Audio 生成（外部ファイル不要）
 *  - オリジナルモード: MSX BASIC の PLAY 文風 MML プレイヤー（矩形波）
 *  - アレンジモード: シンセ SE + チップチューン風 BGM ループ
 */
(function (global) {
  'use strict'

  let ctx = null
  let master = null
  let enabled = true

  function ac() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext
      if (!AC) return null
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = 0.5
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }

  // ------------------------------------------------------------- MML
  // 対応: tN oN lN a-g(+#/-) 数字=音長 付点 rN >< （sN mN vN は無視）
  const NOTE_OFFSET = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

  function parseMML(src) {
    const notes = []
    let tempo = 120
    let octave = 4
    let defLen = 4
    let i = 0
    const s = src.toLowerCase()
    const readNum = () => {
      let n = ''
      while (i < s.length && s[i] >= '0' && s[i] <= '9') n += s[i++]
      return n === '' ? null : parseInt(n, 10)
    }
    while (i < s.length) {
      const ch = s[i++]
      if (ch === 't') tempo = readNum() || tempo
      else if (ch === 'o') octave = readNum() ?? octave
      else if (ch === 'l') defLen = readNum() || defLen
      else if (ch === '>') octave++
      else if (ch === '<') octave--
      else if (ch === 's' || ch === 'm' || ch === 'v') readNum()
      else if (ch === 'r' || (ch >= 'a' && ch <= 'g')) {
        let semitone = null
        if (ch !== 'r') {
          semitone = NOTE_OFFSET[ch]
          if (s[i] === '#' || s[i] === '+') {
            semitone++
            i++
          } else if (s[i] === '-') {
            semitone--
            i++
          }
        }
        let len = readNum() || defLen
        let dur = (60 / tempo) * (4 / len)
        while (s[i] === '.') {
          dur *= 1.5
          i++
        }
        const freq = semitone === null ? null : 440 * Math.pow(2, (12 * (octave - 4) + semitone - 9) / 12)
        notes.push({ freq, dur })
      }
    }
    return notes
  }

  // 複数チャンネル同時演奏
  function playMML() {
    if (!enabled || !ac()) return
    const t0 = ctx.currentTime + 0.03
    for (const src of arguments) {
      let t = t0
      for (const n of parseMML(src)) {
        if (n.freq) {
          const osc = ctx.createOscillator()
          const g = ctx.createGain()
          osc.type = 'square'
          osc.frequency.value = n.freq
          const d = Math.max(0.04, n.dur - 0.02)
          g.gain.setValueAtTime(0.12, t)
          g.gain.exponentialRampToValueAtTime(0.001, t + d)
          osc.connect(g)
          g.connect(master)
          osc.start(t)
          osc.stop(t + d)
        }
        t += n.dur
      }
    }
  }

  // -------------------------------------------------------- アレンジ SE
  function blip(freq, dur, type, vol, slide) {
    if (!enabled || !ac()) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type || 'triangle'
    osc.frequency.setValueAtTime(freq, t)
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur)
    g.gain.setValueAtTime(vol || 0.15, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.connect(g)
    g.connect(master)
    osc.start(t)
    osc.stop(t + dur)
  }

  function noiseBurst(dur, vol, hp) {
    if (!enabled || !ac()) return
    const t = ctx.currentTime
    const len = Math.ceil(ctx.sampleRate * dur)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = hp || 2000
    const g = ctx.createGain()
    g.gain.value = vol || 0.12
    src.connect(f)
    f.connect(g)
    g.connect(master)
    src.start(t)
  }

  const sfx = {
    original: {
      select: () => playMML('t180o4c8g8'),
      cancel: () => playMML('t180o4g8c8'),
      move: () => playMML('t180o4g8c8'),
      capture: () => playMML('t210o4e16c16o3g8'),
      pass: () => playMML('t180o3g8'),
      start: () => playMML('t130o5co4g8.a16o5c2'),
      win: () => playMML('t120o5c4co4g8.a16g8.e16g8.d16c2', 't120o3l4co2agao3cdc2'),
      lose: () => playMML('t100o3e4c4o2a2'),
    },
    arrange: {
      select: () => blip(660, 0.08, 'triangle', 0.12, 990),
      cancel: () => blip(660, 0.08, 'triangle', 0.1, 440),
      move: () => {
        blip(330, 0.12, 'sine', 0.14, 220)
        noiseBurst(0.05, 0.05, 4000)
      },
      capture: () => {
        blip(880, 0.25, 'sawtooth', 0.12, 110)
        noiseBurst(0.18, 0.1, 1200)
      },
      pass: () => blip(220, 0.15, 'sine', 0.1),
      start: () => {
        blip(261.6, 0.5, 'triangle', 0.1)
        setTimeout(() => blip(392, 0.5, 'triangle', 0.1), 120)
        setTimeout(() => blip(523.3, 0.7, 'triangle', 0.12), 240)
      },
      win: () => {
        ;[523.3, 659.3, 784, 1046.5].forEach((f, i) => setTimeout(() => blip(f, 0.6, 'square', 0.08), i * 150))
      },
      lose: () => {
        ;[392, 311.1, 261.6].forEach((f, i) => setTimeout(() => blip(f, 0.5, 'sawtooth', 0.07), i * 200))
      },
    },
  }

  // -------------------------------------------------------- アレンジ BGM
  // Am → F → C → G の 4 小節ループ（ベース + アルペジオ + ドラム）
  const BGM = {
    playing: false,
    timer: null,
    step: 0,
    nextTime: 0,
  }
  const BPM = 112
  const STEP = 60 / BPM / 4 // 16分音符
  const CHORDS = [
    [220.0, 261.6, 329.6], // Am
    [174.6, 220.0, 261.6], // F
    [196.0, 261.6, 329.6], // C(2転)
    [196.0, 246.9, 293.7], // G
  ]
  const BASS = [110.0, 87.31, 65.41, 98.0] // A2 F2 C2 G2

  function scheduleStep(step, t) {
    const bar = Math.floor(step / 16) % 4
    const beat16 = step % 16
    const chord = CHORDS[bar]

    // ベース: 8分刻み
    if (beat16 % 2 === 0) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = beat16 % 8 === 6 ? BASS[bar] * 1.5 : BASS[bar]
      g.gain.setValueAtTime(0.07, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 1.8)
      osc.connect(g)
      g.connect(master)
      osc.start(t)
      osc.stop(t + STEP * 1.8)
    }
    // アルペジオ: 16分で駆け上がり
    {
      const seq = [0, 1, 2, 1]
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 2400
      osc.type = 'sawtooth'
      osc.frequency.value = chord[seq[beat16 % 4]] * (beat16 % 8 >= 4 ? 2 : 1)
      g.gain.setValueAtTime(0.035, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 0.9)
      osc.connect(f)
      f.connect(g)
      g.connect(master)
      osc.start(t)
      osc.stop(t + STEP)
    }
    // キック: 4つ打ち
    if (beat16 % 4 === 0) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(140, t)
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.1)
      g.gain.setValueAtTime(0.16, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
      osc.connect(g)
      g.connect(master)
      osc.start(t)
      osc.stop(t + 0.13)
    }
    // ハイハット: 裏拍
    if (beat16 % 4 === 2) {
      const len = Math.ceil(ctx.sampleRate * 0.04)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
      const src = ctx.createBufferSource()
      src.buffer = buf
      const f = ctx.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.value = 7000
      const g = ctx.createGain()
      g.gain.value = 0.05
      src.connect(f)
      f.connect(g)
      g.connect(master)
      src.start(t)
    }
  }

  function bgmLoop() {
    if (!BGM.playing) return
    while (BGM.nextTime < ctx.currentTime + 0.25) {
      scheduleStep(BGM.step, BGM.nextTime)
      BGM.step++
      BGM.nextTime += STEP
    }
    BGM.timer = setTimeout(bgmLoop, 80)
  }

  function startBGM() {
    if (!ac() || BGM.playing) return
    BGM.playing = true
    BGM.step = 0
    BGM.nextTime = ctx.currentTime + 0.1
    bgmLoop()
  }

  function stopBGM() {
    BGM.playing = false
    if (BGM.timer) clearTimeout(BGM.timer)
  }

  global.HasamiAudio = {
    sfx,
    playMML,
    startBGM,
    stopBGM,
    get bgmPlaying() {
      return BGM.playing
    },
    setEnabled(v) {
      enabled = v
      if (!v) stopBGM()
    },
    get enabled() {
      return enabled
    },
    unlock: ac,
  }
})(typeof window !== 'undefined' ? window : globalThis)
