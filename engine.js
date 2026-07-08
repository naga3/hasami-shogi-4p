/*
 * 4人はさみ将棋 — ゲームエンジン（盤面ロジック + AI）
 * オリジナル: MSX2/MSX2+用 BASIC プログラム「4人はさみ将棋」の移植
 *
 * 盤: 12×12 (0..11)。四隅は空き。各プレイヤー 10 枚を自陣の辺に配置。
 * プレイヤー: 0=青(上) 1=緑(左) 2=黄(下) 3=赤(右)。手番は 0→1→2→3。
 * 移動: 飛車と同じ（タテヨコ直線、追い越し不可）。
 * 捕獲: 動かしたコマと自分のコマ（ダブルスでは味方のコマも可）で
 *       敵のコマ列をタテヨコに挟むと取れる。
 * 敗退: 残り 1 枚以下。勝利: 最後まで生き残った 1 人（ダブルスは 1 チーム）。
 * 寝返りモード: 取ったコマが消えずに自分のコマになる。
 */
(function (global) {
  'use strict'

  const SIZE = 12
  const DIRS = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]

  function initialBoard() {
    const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(null))
    for (let i = 1; i <= 10; i++) {
      b[0][i] = 0 // 青: 上辺
      b[i][0] = 1 // 緑: 左辺
      b[11][i] = 2 // 黄: 下辺
      b[i][11] = 3 // 赤: 右辺
    }
    return b
  }

  function cloneBoard(b) {
    return b.map((row) => row.slice())
  }

  function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE
  }

  // ダブルスモードでは対面 (0&2, 1&3) が味方
  function isFriend(p, q, doubles) {
    if (q === null) return false
    return q === p || (doubles && q % 2 === p % 2)
  }

  function countPieces(b, p) {
    let n = 0
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (b[r][c] === p) n++
    return n
  }

  function piecesOf(b, p) {
    const out = []
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (b[r][c] === p) out.push([r, c])
    return out
  }

  function rookDests(b, r, c) {
    const dests = []
    for (const [dr, dc] of DIRS) {
      let rr = r + dr
      let cc = c + dc
      while (inBounds(rr, cc) && b[rr][cc] === null) {
        dests.push([rr, cc])
        rr += dr
        cc += dc
      }
    }
    return dests
  }

  function genMoves(b, p) {
    const moves = []
    for (const [r, c] of piecesOf(b, p)) {
      for (const [tr, tc] of rookDests(b, r, c)) {
        moves.push({ fr: r, fc: c, tr, tc })
      }
    }
    return moves
  }

  // (r,c) に p のコマが動いた直後の捕獲対象セルを返す
  function computeCaptures(b, r, c, p, doubles) {
    const caps = []
    for (const [dr, dc] of DIRS) {
      const run = []
      let rr = r + dr
      let cc = c + dc
      while (inBounds(rr, cc) && b[rr][cc] !== null && !isFriend(p, b[rr][cc], doubles)) {
        run.push([rr, cc])
        rr += dr
        cc += dc
      }
      if (run.length && inBounds(rr, cc) && isFriend(p, b[rr][cc], doubles)) {
        caps.push(...run)
      }
    }
    return caps
  }

  // 盤面を変更して結果を返す。opts: { negaeri, doubles }
  function applyMove(b, m, p, opts) {
    opts = opts || {}
    b[m.fr][m.fc] = null
    b[m.tr][m.tc] = p
    const capCells = computeCaptures(b, m.tr, m.tc, p, opts.doubles)
    const captured = capCells.map(([r, c]) => ({ r, c, owner: b[r][c] }))
    for (const [r, c] of capCells) b[r][c] = opts.negaeri ? p : null
    return { captured }
  }

  // ---------------------------------------------------------------- AI

  // victim 側（本人 + ダブルスなら味方 0.6 掛け）の被害価値
  function victimValue(owner, victim, doubles) {
    if (owner === victim) return 1
    if (doubles && owner !== null && owner % 2 === victim % 2) return 0.6
    return 0
  }

  // mover が 1 手で victim チームから取れる最大価値（move を仮適用して戻す）
  function bestCaptureAgainst(b, mover, victim, doubles) {
    let best = 0
    for (const [r, c] of piecesOf(b, mover)) {
      for (const [tr, tc] of rookDests(b, r, c)) {
        b[tr][tc] = mover
        b[r][c] = null
        const caps = computeCaptures(b, tr, tc, mover, doubles)
        let v = 0
        for (const [cr, cc] of caps) v += victimValue(b[cr][cc], victim, doubles)
        b[r][c] = mover
        b[tr][tc] = null
        if (v > best) best = v
      }
    }
    return best
  }

  // p が 1 手で取れる最大枚数
  function maxCaptureBy(b, p, doubles) {
    let best = 0
    for (const [r, c] of piecesOf(b, p)) {
      for (const [tr, tc] of rookDests(b, r, c)) {
        b[tr][tc] = p
        b[r][c] = null
        const n = computeCaptures(b, tr, tc, p, doubles).length
        b[r][c] = p
        b[tr][tc] = null
        if (n > best) best = n
      }
    }
    return best
  }

  // 中央寄りを少し好む位置評価
  function positional(b, p) {
    let s = 0
    for (const [r, c] of piecesOf(b, p)) {
      s += 5.5 - Math.abs(r - 5.5) + (5.5 - Math.abs(c - 5.5))
    }
    return s * 1.2
  }

  /*
   * cfg: {
   *   level: 0(原作風よわい) | 1(ふつう) | 2(つよい),
   *   alive: [bool×4], negaeri, doubles,
   *   rng: () => number,
   * }
   */
  function aiChooseMove(board, p, cfg) {
    const rng = cfg.rng || Math.random
    const moves = genMoves(board, p)
    if (!moves.length) return null
    const opts = { negaeri: cfg.negaeri, doubles: cfg.doubles }

    // 原作風: 取れる手があれば取る、なければランダム
    if (cfg.level === 0) {
      let best = []
      let bestC = 0
      for (const m of moves) {
        const b = cloneBoard(board)
        const n = applyMove(b, m, p, opts).captured.length
        if (n > bestC) {
          bestC = n
          best = [m]
        } else if (n === bestC) {
          best.push(m)
        }
      }
      const pool = bestC > 0 ? best : moves
      return pool[Math.floor(rng() * pool.length)]
    }

    const capW = cfg.negaeri ? 170 : 110 // 寝返りでは捕獲の価値が倍増する

    let cands = moves.map((m) => {
      const b = cloneBoard(board)
      const res = applyMove(b, m, p, opts)
      let capVal = 0
      const victims = new Set()
      for (const cp of res.captured) {
        capVal++
        victims.add(cp.owner)
      }
      let elim = 0
      for (const q of victims) {
        if (cfg.alive[q] && countPieces(b, q) < 2) elim++
      }
      return { m, b, capVal, elim, quick: capVal * capW + elim * 150 + positional(b, p) }
    })

    if (cfg.level >= 2 && cands.length > 24) {
      cands.sort((a, b2) => b2.quick - a.quick)
      cands = cands.slice(0, 24)
    }

    // 手番が近い敵から順に反撃リスクを重く見る
    const opponents = []
    for (let d = 1; d < 4; d++) {
      const q = (p + d) % 4
      if (cfg.alive[q] && !isFriend(p, q, cfg.doubles)) opponents.push(q)
    }
    const wts = [1.0, 0.65, 0.4]

    let best = null
    let bestS = -Infinity
    for (const c of cands) {
      let s = c.capVal * capW + c.elim * 150 + positional(c.b, p) + genMoves(c.b, p).length * 0.3
      const lim = cfg.level >= 2 ? opponents.length : Math.min(1, opponents.length)
      for (let i = 0; i < lim; i++) {
        s -= bestCaptureAgainst(c.b, opponents[i], p, cfg.doubles) * 85 * wts[i]
      }
      if (cfg.level >= 2) s += maxCaptureBy(c.b, p, cfg.doubles) * 20
      s += rng() * 6 - 3
      if (s > bestS) {
        bestS = s
        best = c.m
      }
    }
    return best
  }

  const engine = {
    SIZE,
    initialBoard,
    cloneBoard,
    inBounds,
    isFriend,
    countPieces,
    piecesOf,
    rookDests,
    genMoves,
    computeCaptures,
    applyMove,
    aiChooseMove,
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = engine
  } else {
    global.HasamiEngine = engine
  }
})(typeof window !== 'undefined' ? window : globalThis)
