/*
 * 4人はさみ将棋 — UI（設定画面 / 対局画面 / オリジナル・アレンジ両モード）
 */
(function () {
  'use strict'

  const E = window.HasamiEngine
  const A = window.HasamiAudio
  const SIZE = E.SIZE

  const PLAYERS = [
    { jp: '青', en: 'BLUE', pos: '上' },
    { jp: '緑', en: 'GREEN', pos: '左' },
    { jp: '黄', en: 'YELLOW', pos: '下' },
    { jp: '赤', en: 'RED', pos: '右' },
  ]
  const TYPE_LABEL = {
    human: '人間',
    com0: 'COM よわい',
    com1: 'COM ふつう',
    com2: 'COM つよい',
    com9: 'COM 鬼(トレース)',
  }
  const LEVEL_OF = { com0: 0, com1: 1, com2: 2, com9: 2 }
  const QUIET_LIMIT = 100

  // ------------------------------------------------------------ 状態
  let cfg = null // { names[], types[], negaeri, doubles }
  let st = null // { board, turn, alive[], captured[], quiet, passes, over, winners[], lastMove }
  let history = []
  let selected = null // [r,c]
  let destMap = null // Map "r,c" -> {cap:bool}
  let aiTimer = null
  let animating = false
  let theme = 'original'
  let bgmOn = true
  let speed = 450

  const $ = (id) => document.getElementById(id)
  const cells = [] // DOM cells [r*SIZE+c]

  function sfx() {
    return A.sfx[theme === 'original' ? 'original' : 'arrange']
  }

  // ------------------------------------------------------------ 設定画面
  function buildSetup() {
    const wrap = $('playerRows')
    wrap.innerHTML = ''
    PLAYERS.forEach((pl, i) => {
      const row = document.createElement('div')
      row.className = 'player-row'
      row.innerHTML = `
        <span class="chip p${i}"></span>
        <span class="pos-label">${pl.jp}（${pl.pos}）</span>
        <input type="text" id="name${i}" maxlength="12" placeholder="${pl.en}">
        <select id="type${i}">
          <option value="human">人間</option>
          <option value="com0">COM よわい（原作風）</option>
          <option value="com1">COM ふつう</option>
          <option value="com2">COM つよい</option>
          <option value="com9">COM 鬼（トレース）</option>
        </select>`
      wrap.appendChild(row)
    })
    // デフォルト: 青=人間、他=COMつよい
    for (let i = 1; i < 4; i++) $('type' + i).value = 'com2'
  }

  function readSetup() {
    const names = []
    const types = []
    for (let i = 0; i < 4; i++) {
      const t = $('type' + i).value
      types.push(t)
      const raw = $('name' + i).value.trim()
      names.push(raw || (t === 'human' ? PLAYERS[i].en : 'COM ' + PLAYERS[i].en))
    }
    return {
      names,
      types,
      negaeri: $('optNegaeri').checked,
      doubles: $('optDoubles').checked,
    }
  }

  // ------------------------------------------------------------ 対局開始
  function startGame(newCfg) {
    cfg = newCfg
    st = {
      board: E.initialBoard(),
      turn: 0,
      alive: [true, true, true, true],
      captured: [0, 0, 0, 0],
      quiet: 0,
      passes: 0,
      over: false,
      winners: [],
      lastMove: null,
    }
    history = []
    selected = null
    destMap = null
    clearTimeout(aiTimer)
    $('setup').classList.add('hidden')
    $('game').classList.remove('hidden')
    $('banner').classList.add('hidden')
    $('log').innerHTML = ''
    log(`ゲーム開始（${cfg.negaeri ? '寝返り' : '通常'}${cfg.doubles ? '・ダブルス' : ''}）`)
    A.unlock()
    sfx().start()
    updateBGM()
    render()
    setTimeout(startTurn, 600)
  }

  function traceArr() {
    return cfg.types.map((t) => t === 'com9')
  }

  function moveOpts(p) {
    return { negaeri: cfg.negaeri, doubles: cfg.doubles, trace: cfg.types[p] === 'com9' }
  }

  function aliveCount() {
    return st.alive.filter(Boolean).length
  }

  function teamsAlive() {
    if (!cfg.doubles) return aliveCount()
    const t = new Set()
    for (let p = 0; p < 4; p++) if (st.alive[p]) t.add(p % 2)
    return t.size
  }

  // ------------------------------------------------------------ 手番進行
  function startTurn() {
    if (!st || st.over) return
    render()
    const p = st.turn
    const moves = E.genMoves(st.board, p)
    if (moves.length === 0) {
      log(`${cfg.names[p]} は動けないためパス`)
      doPass(true)
      return
    }
    if (cfg.types[p] === 'human') return // クリック待ち
    aiTimer = setTimeout(() => {
      const m = E.aiChooseMove(st.board, p, {
        level: LEVEL_OF[cfg.types[p]],
        alive: st.alive,
        negaeri: cfg.negaeri,
        doubles: cfg.doubles,
        trace: traceArr(),
      })
      if (m) doMove(m)
      else doPass(true)
    }, speed)
  }

  function advanceTurn() {
    do {
      st.turn = (st.turn + 1) % 4
    } while (!st.alive[st.turn])
  }

  function snapshot() {
    history.push({
      board: E.cloneBoard(st.board),
      turn: st.turn,
      alive: st.alive.slice(),
      captured: st.captured.slice(),
      quiet: st.quiet,
      passes: st.passes,
      lastMove: st.lastMove,
    })
    if (history.length > 400) history.shift()
  }

  function doPass(auto) {
    if (st.over) return
    const p = st.turn
    snapshot()
    if (!auto) {
      log(`${cfg.names[p]} はパス`)
      sfx().pass()
    }
    st.passes++
    if (st.passes >= aliveCount()) {
      endByCount('全員が動けなくなった')
      return
    }
    advanceTurn()
    render()
    setTimeout(startTurn, 60)
  }

  function doMove(m) {
    if (st.over) return
    const p = st.turn
    snapshot()
    st.passes = 0
    const res = E.applyMove(st.board, m, p, moveOpts(p))
    st.lastMove = m
    if (res.captured.length) {
      st.captured[p] += res.captured.length
      st.quiet = 0
      const byOwner = {}
      for (const c of res.captured) byOwner[c.owner] = (byOwner[c.owner] || 0) + 1
      const parts = Object.entries(byOwner).map(([q, n]) => `${cfg.names[q]}のコマ×${n}`)
      log(`${cfg.names[p]} が ${parts.join('、')} を${cfg.negaeri ? '寝返らせた！' : '取った！'}`)
      for (const q of new Set(res.captured.map((c) => c.owner))) {
        if (st.alive[q] && E.countPieces(st.board, q) < 2) {
          st.alive[q] = false
          log(`💀 ${cfg.names[q]} は残り1枚以下となり敗退`)
        }
      }
      sfx().capture()
    } else {
      st.quiet++
      sfx().move()
    }
    selected = null
    destMap = null
    animateMove(m, res, () => {
      if (teamsAlive() <= 1) {
        st.over = true
        st.winners = [0, 1, 2, 3].filter((q) => st.alive[q])
        finishGame()
        return
      }
      if (st.quiet >= QUIET_LIMIT) {
        endByCount(`${QUIET_LIMIT}手連続で捕獲なし`)
        return
      }
      advanceTurn()
      startTurn()
    })
  }

  function endByCount(reason) {
    let best = -1
    let winner = 0
    for (let p = 0; p < 4; p++) {
      if (!st.alive[p]) continue
      const n = E.countPieces(st.board, p)
      if (n > best || (n === best && st.captured[p] > st.captured[winner])) {
        best = n
        winner = p
      }
    }
    st.over = true
    st.winners = cfg.doubles ? [0, 1, 2, 3].filter((q) => st.alive[q] && q % 2 === winner % 2) : [winner]
    log(`${reason}ため、残り駒数で決着`)
    finishGame()
  }

  function finishGame() {
    render()
    const names = st.winners.map((q) => cfg.names[q]).join(' & ')
    log(`🏆 ${names} の勝ち！`)
    $('bannerText').innerHTML = `<div class="game-end">＊＊＊＊＊ GAME END ＊＊＊＊＊</div><div class="winner">${esc(names)}! WIN!!</div>`
    $('banner').classList.remove('hidden')
    const humanWon = st.winners.some((q) => cfg.types[q] === 'human')
    const hasHuman = cfg.types.includes('human')
    if (!hasHuman || humanWon) sfx().win()
    else sfx().lose()
  }

  // ------------------------------------------------------------ 人間の入力
  function onCellClick(r, c) {
    if (!st || st.over || animating) return
    const p = st.turn
    if (cfg.types[p] !== 'human') return
    const key = r + ',' + c
    if (selected && destMap && destMap.has(key)) {
      const m = { fr: selected[0], fc: selected[1], tr: r, tc: c }
      selected = null
      destMap = null
      doMove(m)
      return
    }
    if (selected && selected[0] === r && selected[1] === c) {
      selected = null
      destMap = null
      sfx().cancel()
      render()
      return
    }
    if (st.board[r][c] === p) {
      selected = [r, c]
      destMap = new Map()
      for (const [tr, tc] of E.rookDests(st.board, r, c)) {
        const b = E.cloneBoard(st.board)
        const res = E.applyMove(b, { fr: r, fc: c, tr, tc }, p, moveOpts(p))
        destMap.set(tr + ',' + tc, { cap: res.captured.length > 0 })
      }
      sfx().select()
      render()
    }
  }

  function undo() {
    if (!history.length) return
    clearTimeout(aiTimer)
    animating = false
    const hasHuman = cfg.types.includes('human')
    let snap = null
    if (hasHuman) {
      while (history.length) {
        snap = history.pop()
        if (cfg.types[snap.turn] === 'human') break
      }
    } else {
      snap = history.pop()
    }
    if (!snap) return
    st.board = snap.board
    st.turn = snap.turn
    st.alive = snap.alive
    st.captured = snap.captured
    st.quiet = snap.quiet
    st.passes = snap.passes
    st.lastMove = snap.lastMove
    st.over = false
    st.winners = []
    selected = null
    destMap = null
    $('banner').classList.add('hidden')
    log('待った！')
    render()
    setTimeout(startTurn, 100)
  }

  // ------------------------------------------------------------ 描画
  function buildBoard() {
    const board = $('board')
    board.style.setProperty('--size', SIZE)
    board.innerHTML = ''
    cells.length = 0
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div')
        cell.className = 'cell' + ((r + c) % 2 ? ' odd' : '')
        cell.addEventListener('click', () => onCellClick(r, c))
        board.appendChild(cell)
        cells.push(cell)
      }
    }
  }

  function render() {
    if (!st) return
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = cells[r * SIZE + c]
        const v = st.board[r][c]
        let cls = 'cell' + ((r + c) % 2 ? ' odd' : '')
        if (selected && selected[0] === r && selected[1] === c) cls += ' sel'
        const d = destMap && destMap.get(r + ',' + c)
        if (d) cls += d.cap ? ' dest cap' : ' dest'
        if (st.lastMove) {
          if (st.lastMove.fr === r && st.lastMove.fc === c) cls += ' last-from'
          if (st.lastMove.tr === r && st.lastMove.tc === c) cls += ' last-to'
        }
        cell.className = cls
        if (v === null) {
          cell.innerHTML = ''
        } else {
          const dead = !st.alive[v]
          cell.innerHTML = `<div class="piece p${v}${dead ? ' dead' : ''}"></div>`
        }
      }
    }
    document.body.style.setProperty('--turn-color', `var(--c${st.turn})`)
    renderPanel()
  }

  function renderPanel() {
    const panel = $('players')
    panel.innerHTML = ''
    for (let p = 0; p < 4; p++) {
      const card = document.createElement('div')
      const isTurn = !st.over && st.turn === p
      card.className = 'pcard' + (isTurn ? ' turn' : '') + (st.alive[p] ? '' : ' dead')
      const team = cfg.doubles ? `<span class="team">チーム${p % 2 === 0 ? 'A' : 'B'}</span>` : ''
      card.innerHTML = `
        <span class="chip p${p}"></span>
        <span class="pname">${esc(cfg.names[p])}</span>${team}
        <span class="ptype">${TYPE_LABEL[cfg.types[p]]}</span>
        <span class="pstat">駒${E.countPieces(st.board, p)} / 取${st.captured[p]}</span>
        <span class="pmark">${st.alive[p] ? (isTurn ? '▶ 手番' : '') : '敗退'}</span>`
      panel.appendChild(card)
    }
  }

  // 移動アニメーション（ゴースト駒を from→to へ滑らせる）
  function animateMove(m, res, done) {
    render()
    const board = $('board')
    const fromCell = cells[m.fr * SIZE + m.fc]
    const toCell = cells[m.tr * SIZE + m.tc]
    const piece = toCell.querySelector('.piece')
    if (!piece) {
      afterAnim(res, done)
      return
    }
    animating = true
    const br = board.getBoundingClientRect()
    const fr = fromCell.getBoundingClientRect()
    const tr = toCell.getBoundingClientRect()
    const ghost = piece.cloneNode(true)
    ghost.classList.add('ghost')
    ghost.style.width = fr.width * 0.82 + 'px'
    ghost.style.height = fr.height * 0.82 + 'px'
    ghost.style.transform = `translate(${fr.left - br.left + fr.width * 0.09}px, ${fr.top - br.top + fr.height * 0.09}px)`
    board.appendChild(ghost)
    piece.style.visibility = 'hidden'
    const dur = Math.min(220, Math.max(90, speed * 0.4))
    ghost.style.transition = `transform ${dur}ms ease-out`
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ghost.style.transform = `translate(${tr.left - br.left + tr.width * 0.09}px, ${tr.top - br.top + tr.height * 0.09}px)`
      })
    })
    setTimeout(() => {
      ghost.remove()
      piece.style.visibility = ''
      afterAnim(res, done)
    }, dur + 30)
  }

  function afterAnim(res, done) {
    // 取られたマスをフラッシュ
    for (const c of res.captured) {
      const cell = cells[c.r * SIZE + c.c]
      cell.classList.add('boom')
      setTimeout(() => cell.classList.remove('boom'), 500)
    }
    animating = false
    render()
    setTimeout(done, res.captured.length ? 350 : 40)
  }

  function log(msg) {
    const el = document.createElement('div')
    el.textContent = msg
    const box = $('log')
    box.prepend(el)
    while (box.children.length > 60) box.lastChild.remove()
  }

  function esc(s) {
    return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
  }

  // ------------------------------------------------------------ モード / BGM
  function applyTheme() {
    document.body.classList.toggle('theme-original', theme === 'original')
    document.body.classList.toggle('theme-arrange', theme === 'arrange')
    $('modeBtn').textContent = theme === 'original' ? '🎨 アレンジ' : '📺 オリジナル'
    updateBGM()
  }

  function updateBGM() {
    const inGame = st && !$('game').classList.contains('hidden')
    if (theme === 'arrange' && bgmOn && inGame) A.startBGM()
    else A.stopBGM()
    $('bgmBtn').textContent = bgmOn ? '♪ BGM ON' : '♪ BGM OFF'
    $('bgmBtn').classList.toggle('off', !bgmOn)
  }

  // ------------------------------------------------------------ 初期化
  function init() {
    buildSetup()
    buildBoard()
    theme = $('optModeArrange').checked ? 'arrange' : 'original'
    applyTheme()

    $('startBtn').addEventListener('click', () => {
      theme = $('optModeArrange').checked ? 'arrange' : 'original'
      bgmOn = $('optBgm').checked
      applyTheme()
      startGame(readSetup())
    })
    $('passBtn').addEventListener('click', () => {
      if (st && !st.over && cfg.types[st.turn] === 'human' && !animating) doPass(false)
    })
    $('undoBtn').addEventListener('click', undo)
    $('modeBtn').addEventListener('click', () => {
      theme = theme === 'original' ? 'arrange' : 'original'
      applyTheme()
    })
    $('bgmBtn').addEventListener('click', () => {
      bgmOn = !bgmOn
      A.unlock()
      updateBGM()
    })
    $('speedRange').addEventListener('input', (e) => {
      speed = 1300 - Number(e.target.value)
    })
    $('backBtn').addEventListener('click', () => {
      clearTimeout(aiTimer)
      st = null
      A.stopBGM()
      $('game').classList.add('hidden')
      $('setup').classList.remove('hidden')
    })
    $('replayBtn').addEventListener('click', () => {
      if (cfg) startGame(cfg)
    })
    $('bannerReplay').addEventListener('click', () => {
      if (cfg) startGame(cfg)
    })
    $('bannerBack').addEventListener('click', () => {
      clearTimeout(aiTimer)
      st = null
      A.stopBGM()
      $('game').classList.add('hidden')
      $('setup').classList.remove('hidden')
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'g' || e.key === 'G') {
        if (st && !st.over && !$('game').classList.contains('hidden') && cfg.types[st.turn] === 'human' && !animating) {
          doPass(false)
        }
      }
    })
  }

  document.addEventListener('DOMContentLoaded', init)
})()
