/*
 * エンジン検証用シミュレータ: AI 同士で最後まで対局させ、
 * 正常終了（勝者確定 or 膠着打ち切り）することを確認する。
 *   node test/sim.js
 */
const E = require('../engine.js')

const QUIET_LIMIT = 100 // 無捕獲がこの手数続いたら残り駒数で決着

function aliveCount(alive) {
  return alive.filter(Boolean).length
}

function teamsAlive(alive, doubles) {
  if (!doubles) return aliveCount(alive)
  const t = new Set()
  for (let p = 0; p < 4; p++) if (alive[p]) t.add(p % 2)
  return t.size
}

function runGame(cfg) {
  const board = E.initialBoard()
  const alive = [true, true, true, true]
  const captured = [0, 0, 0, 0]
  let turn = 0
  let quiet = 0
  let passes = 0
  const opts = { negaeri: cfg.negaeri, doubles: cfg.doubles }

  for (let step = 0; step < 3000; step++) {
    if (!alive[turn]) {
      turn = (turn + 1) % 4
      continue
    }
    const p = turn
    const m = E.aiChooseMove(board, p, {
      level: cfg.levels[p],
      alive,
      negaeri: cfg.negaeri,
      doubles: cfg.doubles,
      trace: cfg.trace,
    })
    if (!m) {
      passes++
      if (passes >= aliveCount(alive)) return endByCount(board, alive, captured, step, 'all-blocked')
      turn = (turn + 1) % 4
      continue
    }
    passes = 0
    const res = E.applyMove(board, m, p, { ...opts, trace: !!(cfg.trace && cfg.trace[p]) })
    if (res.captured.length) {
      captured[p] += res.captured.length
      quiet = 0
      for (const q of new Set(res.captured.map((c) => c.owner))) {
        if (alive[q] && E.countPieces(board, q) < 2) alive[q] = false
      }
    } else {
      quiet++
    }
    if (teamsAlive(alive, cfg.doubles) <= 1) {
      const winners = []
      for (let q = 0; q < 4; q++) if (alive[q]) winners.push(q)
      return { result: 'win', winners, steps: step + 1, captured }
    }
    if (quiet >= QUIET_LIMIT) return endByCount(board, alive, captured, step, 'quiet')
    turn = (turn + 1) % 4
  }
  return { result: 'TIMEOUT', steps: 3000, captured }
}

function endByCount(board, alive, captured, step, reason) {
  let best = -1
  let winner = null
  for (let p = 0; p < 4; p++) {
    if (!alive[p]) continue
    const n = E.countPieces(board, p)
    if (n > best || (n === best && captured[p] > captured[winner])) {
      best = n
      winner = p
    }
  }
  return { result: reason, winners: [winner], steps: step + 1, captured }
}

const NAMES = ['青', '緑', '黄', '赤']
const cases = [
  { label: '全員つよい', levels: [2, 2, 2, 2], n: 4 },
  { label: 'つよい1 vs よわい3', levels: [2, 0, 0, 0], n: 4 },
  { label: 'つよい vs ふつう混合', levels: [2, 1, 2, 1], n: 3 },
  { label: '寝返りモード', levels: [2, 2, 2, 2], negaeri: true, n: 3 },
  { label: 'ダブルスモード', levels: [2, 2, 2, 2], doubles: true, n: 3 },
  { label: 'トレース(赤=鬼)', levels: [2, 2, 2, 2], trace: [false, false, false, true], n: 3 },
]

let fail = 0
for (const c of cases) {
  const wins = [0, 0, 0, 0]
  let totalSteps = 0
  for (let i = 0; i < c.n; i++) {
    const r = runGame(c)
    if (r.result === 'TIMEOUT') {
      console.log(`NG [${c.label}] game${i}: 打ち切り(3000手)`)
      fail++
      continue
    }
    for (const w of r.winners) wins[w]++
    totalSteps += r.steps
  }
  console.log(
    `OK [${c.label}] 勝ち数 ${wins.map((w, i) => `${NAMES[i]}${w}`).join(' ')} / 平均${Math.round(totalSteps / c.n)}手`
  )
}

// 強さ検証: level2 (青) が level0 ×3 に対してどれだけ勝つか
{
  const wins = [0, 0, 0, 0]
  const N = 12
  for (let i = 0; i < N; i++) {
    const r = runGame({ levels: [2, 0, 0, 0] })
    if (r.result === 'TIMEOUT') {
      fail++
      continue
    }
    for (const w of r.winners) wins[w]++
  }
  console.log(`強さ検証: つよい(青) ${wins[0]}/${N} 勝 (よわい3人相手)`)
  if (wins[0] < N * 0.7) {
    console.log('NG: つよいAIの勝率が低すぎる')
    fail++
  }
}

process.exit(fail ? 1 : 0)
