import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { THEMES } from "./themes.mjs";

// Layout
const PADDING = 15;
const PADDLE_WIDTH = 50;
const PADDLE_HEIGHT = 6;
const PADDLE_RADIUS = 3;
const PADDLE_WIDE_SCALE = 1.65;
const PADDLE_BRICK_GAP = 55;
const BALL_RADIUS = 5;
const BRICK_SIZE = 12;
const BRICK_GAP = 3;
const BRICK_RADIUS = 3;
const POWERUP_SIZE = 11;
const POWERUP_FALL_SPEED = 1.4;
const POWERUP_SPAWN_INTERVAL = 4;
const HUD_HEIGHT = 16;
const STARTING_LIVES = 3;

// Simulation
const BALL_SPEED = 6;
const FAST_SPEED = 8.5;
const SLOW_SPEED = 4.5;
const SUB_STEPS = 8;
const SECONDS_PER_FRAME = 1 / 24;
const FRAME_SAMPLE = 4;
const MAX_FRAMES = 40000;
const MAX_BALLS = 4;
const MIN_BOUNCE_ANGLE = 0.35;
const MIN_VX_RATIO = Math.sin(MIN_BOUNCE_ANGLE);
const MIN_VY_RATIO = Math.sin(MIN_BOUNCE_ANGLE);
const WIDE_DURATION = 360;
const FAST_DURATION = 240;
const SLOW_DURATION = 240;
const PADDLE_MAX_SPEED = 3.8;
const PADDLE_ACCEL = 0.22;
const BALL_FALL_TRACK_FRAMES = 90;
const POWERUP_CHASE_FRAMES = 55;

/** @typedef {'multi' | 'wide' | 'fast' | 'slow' | 'xp'} PowerUpType */

/** @type {Record<Exclude<PowerUpType, 'xp'>, { label: string, color: string }>} */
const POWERUP_META = {
  multi: { label: "●●", color: "#f7ff00" },
  wide: { label: "↔", color: "#58A6FF" },
  fast: { label: "»", color: "#ff6b35" },
  slow: { label: "«", color: "#b388ff" },
};

const XP_POWERUP_COLOR = "#3ddc84";

/** @type {PowerUpType[]} */
const POWERUP_TYPES = ["multi", "wide", "fast", "slow", "xp"];

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function xpFromContribution(contributionCount, level) {
  if (contributionCount <= 0) return 0;
  const tier = [8, 15, 28, 45, 70][level] ?? 10;
  return tier + contributionCount * 4;
}

function brickPoints(contributionCount, level) {
  return 10 + level * 15 + contributionCount * 6;
}

/**
 * @param {string} userName
 * @param {string} githubToken
 */
async function fetchContributions(userName, githubToken) {
  const query = `
    query($userName:String!) {
      user(login: $userName) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                contributionLevel
                contributionCount
              }
            }
          }
        }
      }
    }`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `bearer ${githubToken}`,
    },
    body: JSON.stringify({ query, variables: { userName } }),
  });

  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);

  const json = await res.json();
  if (json.errors) throw new Error(`GitHub GraphQL error: ${JSON.stringify(json.errors)}`);

  const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
  /** @type {({ level: number, contributionCount: number } | null)[][]} */
  const days = [];

  for (let c = 0; c < weeks.length; c++) {
    days[c] = [];
    for (let r = 0; r < weeks[c].contributionDays.length; r++) {
      const day = weeks[c].contributionDays[r];
      const level =
        (day.contributionLevel === "FOURTH_QUARTILE" && 4) ||
        (day.contributionLevel === "THIRD_QUARTILE" && 3) ||
        (day.contributionLevel === "SECOND_QUARTILE" && 2) ||
        (day.contributionLevel === "FIRST_QUARTILE" && 1) ||
        0;
      days[c][r] = { level, contributionCount: day.contributionCount };
    }
  }

  return days;
}

function normalizeVelocity(vx, vy, speed) {
  const mag = Math.hypot(vx, vy);
  if (mag < 1e-6) return { vx: 0, vy: -speed };
  return { vx: (vx / mag) * speed, vy: (vy / mag) * speed };
}

function clampVelocity(vx, vy, speed, biasX = 0) {
  let nvx = vx;
  let nvy = vy;
  const minVx = speed * MIN_VX_RATIO;
  const minVy = speed * MIN_VY_RATIO;

  if (Math.abs(nvx) < minVx) {
    const sign = nvx !== 0 ? Math.sign(nvx) : (biasX !== 0 ? Math.sign(biasX) : 1);
    nvx = sign * minVx;
    const rem = speed * speed - nvx * nvx;
    nvy = Math.sign(nvy || -1) * Math.sqrt(Math.max(rem, minVy * minVy));
  }

  if (Math.abs(nvy) < minVy) {
    const sign = nvy !== 0 ? Math.sign(nvy) : (biasX !== 0 ? -Math.sign(biasX) : -1);
    nvy = sign * minVy;
    const rem = speed * speed - nvy * nvy;
    nvx = Math.sign(nvx || biasX || 1) * Math.sqrt(Math.max(rem, minVx * minVx));
  }

  return normalizeVelocity(nvx, nvy, speed);
}

/** Prevent horizontal-only trajectories after any collision. */
function deflatVelocity(vx, vy, speed, preferDown = true) {
  const minVy = speed * MIN_VY_RATIO;
  if (Math.abs(vy) >= minVy * 0.9) return { vx, vy };
  const sign = vy !== 0 ? Math.sign(vy) : (preferDown ? 1 : -1);
  const nvy = sign * minVy;
  const nvx = Math.sign(vx || 1) * Math.sqrt(Math.max(speed * speed - nvy * nvy, 0));
  return clampVelocity(nvx, nvy, speed, vx);
}

function circleOverlapsRect(cx, cy, r, rx, ry, rw, rh) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Resolve circle-rect overlap by pushing the ball out along the shallowest axis.
 * Only returns a bounce when the ball is moving into the surface.
 * @returns {{ side: string, x: number, y: number, vx: number, vy: number } | null}
 */
function resolveCircleRect(cx, cy, r, rx, ry, rw, rh, vx, vy) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  if (dx * dx + dy * dy > r * r) return null;

  const overlapLeft = cx + r - rx;
  const overlapRight = rx + rw - (cx - r);
  const overlapTop = cy + r - ry;
  const overlapBottom = ry + rh - (cy - r);

  const absVx = Math.abs(vx);
  const absVy = Math.abs(vy);
  const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

  let nx = 0;
  let ny = 0;
  let side = "top";
  let x = cx;
  let y = cy;

  // Prefer collision axis aligned with velocity — stops horizontal gutter traps
  if (absVx > absVy * 1.1) {
    if (vx > 0) {
      side = "right"; nx = 1; x = rx + rw + r + 0.01;
    } else {
      side = "left"; nx = -1; x = rx - r - 0.01;
    }
  } else if (absVy > absVx * 1.1) {
    if (vy > 0) {
      side = "bottom"; ny = 1; y = ry + rh + r + 0.01;
    } else {
      side = "top"; ny = -1; y = ry - r - 0.01;
    }
  } else if (minOverlap === overlapLeft) {
    side = "left"; nx = -1; x = rx - r - 0.01;
  } else if (minOverlap === overlapRight) {
    side = "right"; nx = 1; x = rx + rw + r + 0.01;
  } else if (minOverlap === overlapTop) {
    side = "top"; ny = -1; y = ry - r - 0.01;
  } else {
    side = "bottom"; ny = 1; y = ry + rh + r + 0.01;
  }

  if (vx * nx + vy * ny >= 0) return null;

  const dot = vx * nx + vy * ny;
  let rvx = vx - 2 * dot * nx;
  let rvy = vy - 2 * dot * ny;

  // Side bounces must gain vertical component — never slide horizontally
  if (side === "left" || side === "right") {
    const speed = Math.hypot(vx, vy) || BALL_SPEED;
    const flat = deflatVelocity(rvx, rvy, speed, true);
    rvx = flat.vx;
    rvy = flat.vy;
  }

  return { side, x, y, vx: rvx, vy: rvy };
}

/**
 * Only collide on first contact this step — not while already resting inside.
 */
function newCircleRectHit(px, py, cx, cy, r, rx, ry, rw, rh, vx, vy) {
  if (!circleOverlapsRect(cx, cy, r, rx, ry, rw, rh)) return null;
  if (circleOverlapsRect(px, py, r, rx, ry, rw, rh)) return null;
  return resolveCircleRect(cx, cy, r, rx, ry, rw, rh, vx, vy);
}

/**
 * @typedef {{ x: number, y: number, status: "visible" | "hidden", colorClass: string, hasCommit: boolean, index: number, contributionCount: number, level: number }} Brick
 * @typedef {{ id: number, slot: number, x: number, y: number, vx: number, vy: number, speed: number, alive: boolean }} Ball
 * @typedef {{ x: number, y: number, type: PowerUpType, id: number, xpValue?: number }} PowerUp
 * @typedef {{ slot: number, x: number, y: number, alive: boolean }} BallSnapshot
 * @typedef {{ paddleX: number, paddleWidth: number, balls: BallSnapshot[], bricks: ("visible"|"hidden")[], powerUps: {x:number,y:number,type:PowerUpType,xpValue?:number}[], score: number, lives: number, xp: number, gameOver: boolean }} FrameState
 */

/**
 * @param {Brick[]} bricks
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} paddleY
 * @param {boolean} enableGhostBricks
 * @param {number} seed
 */
function simulate(bricks, canvasWidth, canvasHeight, paddleY, enableGhostBricks, seed) {
  const rand = mulberry32(seed);
  const topBound = HUD_HEIGHT + PADDING + BALL_RADIUS;
  const paddleContactY = paddleY - BALL_RADIUS;
  const paddleBottom = paddleY + PADDLE_HEIGHT;
  const launchAngle = -Math.PI / 4 + (rand() - 0.5) * 0.9;
  let nextBallId = 0;
  /** @type {number[]} */
  let freeSlots = [1, 2, 3];
  const allocSlot = () => (freeSlots.length > 0 ? /** @type {number} */ (freeSlots.pop()) : null);
  const releaseSlot = (/** @type {number} */ slot) => {
    if (slot > 0 && !freeSlots.includes(slot)) freeSlots.push(slot);
  };

  /** @type {Ball[]} */
  let balls = [{
    id: nextBallId++,
    slot: 0,
    x: canvasWidth / 2,
    y: paddleContactY - 2,
    vx: BALL_SPEED * Math.cos(launchAngle),
    vy: BALL_SPEED * Math.sin(launchAngle),
    speed: BALL_SPEED,
    alive: true,
  }];

  const simulatedBricks = bricks.map((b, i) => ({ ...b, index: i }));
  /** @type {FrameState[]} */
  const frameHistory = [];
  /** @type {PowerUp[]} */
  let powerUps = [];
  let powerUpId = 0;
  let paddleX = (canvasWidth - PADDLE_WIDTH) / 2;
  let paddleVel = 0;
  let paddleWidth = PADDLE_WIDTH;
  let wideUntil = 0;
  let speedMod = /** @type {{ type: 'fast'|'slow'|null, until: number }} */ ({ type: null, until: 0 });
  let frame = 0;
  let brokenCount = 0;
  let recordExtra = false;
  let lives = STARTING_LIVES;
  let score = 0;
  let xp = 0;
  let gameOver = false;
  let xpSpawned = false;

  const breakable = (/** @type {Brick} */ b) =>
    b.status === "visible" && (!enableGhostBricks || b.hasCommit);

  const collidable = (/** @type {Brick} */ b) =>
    enableGhostBricks ? b.status === "visible" && b.hasCommit : b.status === "visible";

  const getBallSpeed = (/** @type {Ball} */ ball) => {
    if (speedMod.type === "fast" && frame < speedMod.until) return FAST_SPEED;
    if (speedMod.type === "slow" && frame < speedMod.until) return SLOW_SPEED;
    return ball.speed;
  };

  const spawnPowerUp = (/** @type {Brick} */ brick) => {
    if (!brick.hasCommit) return;
    brokenCount++;
    if (brokenCount % POWERUP_SPAWN_INTERVAL !== 0) return;

    /** @type {PowerUpType} */
    let type;
    if (!xpSpawned) {
      type = "xp";
      xpSpawned = true;
    } else {
      type = POWERUP_TYPES[Math.floor(rand() * POWERUP_TYPES.length)];
      if (type === "xp" && brick.contributionCount === 0) {
        type = /** @type {PowerUpType} */ (POWERUP_TYPES[Math.floor(rand() * 4)]);
      }
    }

    const pu = {
      x: brick.x + BRICK_SIZE / 2,
      y: brick.y + BRICK_SIZE / 2,
      type,
      id: powerUpId++,
    };
    if (type === "xp") {
      pu.xpValue = xpFromContribution(brick.contributionCount, brick.level);
    }
    powerUps.push(pu);
    recordExtra = true;
  };

  const applyPowerUp = (/** @type {PowerUp} */ pu) => {
    const type = pu.type;
    if (type === "xp") {
      xp += pu.xpValue ?? xpFromContribution(1, 1);
      score += pu.xpValue ?? 10;
      recordExtra = true;
    } else if (type === "multi") {
      const alive = balls.filter((b) => b.alive);
      const src = alive[0] ?? balls[0];
      const spawnX = paddleX + paddleWidth / 2;
      const spawnY = paddleContactY - 2;
      const angles = [-0.75, 0.75, -1.15, 1.15];
      for (const a of angles) {
        if (balls.filter((b) => b.alive).length >= MAX_BALLS) break;
        const slot = allocSlot();
        if (slot === null) break;
        const speed = getBallSpeed(src);
        balls.push({
          id: nextBallId++,
          slot,
          x: spawnX,
          y: spawnY,
          vx: speed * Math.sin(a),
          vy: -speed * Math.cos(a),
          speed: BALL_SPEED,
          alive: true,
        });
      }
      recordExtra = true;
    } else if (type === "wide") {
      wideUntil = frame + WIDE_DURATION;
    } else if (type === "fast") {
      speedMod = { type: "fast", until: frame + FAST_DURATION };
      for (const b of balls) {
        const v = clampVelocity(b.vx, b.vy, FAST_SPEED, b.vx);
        b.vx = v.vx; b.vy = v.vy;
      }
    } else if (type === "slow") {
      speedMod = { type: "slow", until: frame + SLOW_DURATION };
      for (const b of balls) {
        const v = clampVelocity(b.vx, b.vy, SLOW_SPEED, b.vx);
        b.vx = v.vx; b.vy = v.vy;
      }
    }
  };

  const respawnBall = () => {
    const angle = -Math.PI / 4 + (rand() - 0.5) * 0.6;
    freeSlots = [1, 2, 3];
    balls = [{
      id: nextBallId++,
      slot: 0,
      x: paddleX + paddleWidth / 2,
      y: paddleContactY - 2,
      vx: BALL_SPEED * Math.cos(angle),
      vy: BALL_SPEED * Math.sin(angle),
      speed: BALL_SPEED,
      alive: true,
    }];
    recordExtra = true;
  };

  const aliveBalls = () => balls.filter((b) => b.alive);

  const ensureBallInPlay = () => {
    if (gameOver) return;
    if (aliveBalls().length === 0) {
      lives--;
      if (lives > 0) respawnBall();
      else gameOver = true;
      recordExtra = true;
    }
  };

  const snapshotBalls = () =>
    Array.from({ length: MAX_BALLS }, (_, slot) => {
      const ball = balls.find((b) => b.alive && b.slot === slot);
      if (!ball) return { slot, x: -100, y: -100, alive: false };
      return {
        slot,
        x: ball.x,
        y: Math.min(ball.y, paddleContactY),
        alive: true,
      };
    });

  const movePaddleToward = (/** @type {number} */ targetX, /** @type {number} */ boost = 1) => {
    const clamped = clampPaddleX(targetX, paddleWidth, canvasWidth);
    const dx = clamped - paddleX;
    const maxStep = (PADDLE_MAX_SPEED * boost) / SUB_STEPS;
    const desiredVel = Math.abs(dx) <= maxStep
      ? dx
      : Math.sign(dx) * maxStep;
    paddleVel += (desiredVel - paddleVel) * PADDLE_ACCEL;
    paddleVel = Math.max(-maxStep, Math.min(maxStep, paddleVel));
    paddleX = clampPaddleX(paddleX + paddleVel, paddleWidth, canvasWidth);
    if (Math.abs(dx) < 0.05) paddleVel *= 0.5;
  };

  while (simulatedBricks.some(breakable) && frame < MAX_FRAMES && !gameOver) {
    paddleWidth = frame < wideUntil ? PADDLE_WIDTH * PADDLE_WIDE_SCALE : PADDLE_WIDTH;
    const aliveCount = aliveBalls().length;
    const saveBoost = aliveCount <= 1 ? 1.35 : 1;

    for (let sub = 0; sub < SUB_STEPS; sub++) {
      const target = getPaddleTarget(
        powerUps, balls, paddleX, paddleY, paddleWidth, canvasWidth, paddleContactY, topBound, saveBoost,
      );
      movePaddleToward(target.x, saveBoost);

      for (let bi = 0; bi < balls.length; bi++) {
        const ball = balls[bi];
        if (!ball.alive) continue;
        const speed = getBallSpeed(ball);
        const stepVx = ball.vx / SUB_STEPS;
        const stepVy = ball.vy / SUB_STEPS;
        const prevX = ball.x;
        const prevY = ball.y;

        ball.x += stepVx;
        ball.y += stepVy;

        // Wall collisions — only when crossing boundary this sub-step
        if (ball.x - BALL_RADIUS < PADDING && prevX - BALL_RADIUS >= PADDING) {
          ball.x = PADDING + BALL_RADIUS;
          ball.vx = Math.abs(ball.vx);
          const cv = clampVelocity(ball.vx, ball.vy, speed, 1);
          ({ vx: ball.vx, vy: ball.vy } = deflatVelocity(cv.vx, cv.vy, speed, true));
        } else if (ball.x + BALL_RADIUS > canvasWidth - PADDING && prevX + BALL_RADIUS <= canvasWidth - PADDING) {
          ball.x = canvasWidth - PADDING - BALL_RADIUS;
          ball.vx = -Math.abs(ball.vx);
          const cv = clampVelocity(ball.vx, ball.vy, speed, -1);
          ({ vx: ball.vx, vy: ball.vy } = deflatVelocity(cv.vx, cv.vy, speed, true));
        }

        if (ball.y - BALL_RADIUS < topBound && prevY - BALL_RADIUS >= topBound) {
          ball.y = topBound;
          ball.vy = Math.abs(ball.vy);
          ({ vx: ball.vx, vy: ball.vy } = clampVelocity(ball.vx, ball.vy, speed, ball.x - canvasWidth / 2));
        }

        // Paddle collision — swept + overlap + hard ceiling
        const horizOnPaddle =
          ball.x + BALL_RADIUS > paddleX &&
          ball.x - BALL_RADIUS < paddleX + paddleWidth;
        const prevTop = prevY - BALL_RADIUS;
        const currBottom = ball.y + BALL_RADIUS;
        const sweptPaddle =
          ball.vy > 0 &&
          horizOnPaddle &&
          prevTop < paddleBottom &&
          currBottom > paddleY;
        const insidePaddle =
          horizOnPaddle &&
          currBottom > paddleY &&
          ball.y - BALL_RADIUS < paddleBottom;

        if (sweptPaddle || insidePaddle) {
          const hitPos = Math.max(0.05, Math.min(0.95, (ball.x - paddleX) / paddleWidth));
          const maxDeflection = Math.PI * 0.4;
          let angle = (hitPos - 0.5) * maxDeflection * 2;
          if (Math.abs(angle) < MIN_BOUNCE_ANGLE) {
            angle = Math.sign(angle || (ball.x - paddleX - paddleWidth / 2) || 1) * MIN_BOUNCE_ANGLE;
          }
          ball.vx = speed * Math.sin(angle);
          ball.vy = -speed * Math.cos(angle);
          ball.y = paddleContactY - 0.01;
          ({ vx: ball.vx, vy: ball.vy } = clampVelocity(ball.vx, ball.vy, speed, ball.x - paddleX - paddleWidth / 2));
          recordExtra = true;
        } else if (horizOnPaddle && ball.y > paddleContactY) {
          ball.y = paddleContactY - 0.01;
          if (ball.vy > 0) ball.vy = -Math.abs(ball.vy);
          ({ vx: ball.vx, vy: ball.vy } = clampVelocity(
            ball.vx, ball.vy, speed, ball.x - paddleX - paddleWidth / 2,
          ));
          recordExtra = true;
        } else if (ball.y + BALL_RADIUS > paddleBottom) {
          ball.alive = false;
          releaseSlot(ball.slot);
          ball.y = Infinity;
        }

        // Brick collisions — first contact only, closest brick wins
        let bestHit = /** @type {{ i: number, dist: number, hit: NonNullable<ReturnType<typeof resolveCircleRect>> } | null} */ (null);

        for (let i = 0; i < simulatedBricks.length; i++) {
          const brick = simulatedBricks[i];
          if (!collidable(brick)) continue;

          const hit = newCircleRectHit(
            prevX, prevY, ball.x, ball.y, BALL_RADIUS,
            brick.x, brick.y, BRICK_SIZE, BRICK_SIZE,
            ball.vx, ball.vy,
          );
          if (!hit) continue;

          const dist = (brick.x + BRICK_SIZE / 2 - prevX) ** 2 + (brick.y + BRICK_SIZE / 2 - prevY) ** 2;
          if (!bestHit || dist < bestHit.dist) bestHit = { i, dist, hit };
        }

        if (bestHit) {
          const brick = simulatedBricks[bestHit.i];
          ball.x = bestHit.hit.x;
          ball.y = bestHit.hit.y;
          ball.vx = bestHit.hit.vx;
          ball.vy = bestHit.hit.vy;
          const cv = clampVelocity(
            ball.vx, ball.vy, speed, ball.x - (brick.x + BRICK_SIZE / 2),
          );
          ({ vx: ball.vx, vy: ball.vy } = deflatVelocity(
            cv.vx, cv.vy, speed, bestHit.hit.side !== "top",
          ));

          if (breakable(brick)) {
            brick.status = "hidden";
            score += brickPoints(brick.contributionCount, brick.level);
            spawnPowerUp(brick);
            recordExtra = true;
          }
        }

        ball.x = Math.max(PADDING + BALL_RADIUS, Math.min(canvasWidth - PADDING - BALL_RADIUS, ball.x));
        if (ball.y !== Infinity) {
          const maxY = horizOnPaddle ? paddleContactY : paddleBottom;
          ball.y = Math.max(topBound, Math.min(maxY, ball.y));
        }

        // Safety net: never allow a purely horizontal trajectory
        const flat = deflatVelocity(ball.vx, ball.vy, speed, ball.y < paddleY);
        ball.vx = flat.vx;
        ball.vy = flat.vy;
      }

      // Fall power-ups
      powerUps = powerUps.filter((pu) => {
        pu.y += POWERUP_FALL_SPEED / SUB_STEPS;
        const half = POWERUP_SIZE / 2;
        const caught =
          pu.y + half >= paddleY &&
          pu.y - half <= paddleY + PADDLE_HEIGHT &&
          pu.x >= paddleX - half &&
          pu.x <= paddleX + paddleWidth + half;
        if (caught) {
          applyPowerUp(pu);
          return false;
        }
        return pu.y < canvasHeight + POWERUP_SIZE;
      });

      ensureBallInPlay();
    }

    if (frame % FRAME_SAMPLE === 0 || recordExtra) {
      frameHistory.push({
        paddleX,
        paddleWidth,
        balls: snapshotBalls(),
        bricks: simulatedBricks.map((b) => b.status),
        powerUps: powerUps.map((pu) => ({
          x: pu.x, y: pu.y, type: pu.type, id: pu.id, xpValue: pu.xpValue,
        })),
        score,
        lives,
        xp,
        gameOver,
      });
      recordExtra = false;
    }

    frame++;
  }

  if (frameHistory.length === 0 || frameHistory[frameHistory.length - 1].gameOver !== gameOver) {
    frameHistory.push({
      paddleX,
      paddleWidth,
      balls: snapshotBalls(),
      bricks: simulatedBricks.map((b) => b.status),
      powerUps: powerUps.map((pu) => ({
        x: pu.x, y: pu.y, type: pu.type, id: pu.id, xpValue: pu.xpValue,
      })),
      score,
      lives,
      xp,
      gameOver,
    });
  }

  return frameHistory;
}

function predictBallInterceptX(ball, paddleY, canvasWidth, topBound = HUD_HEIGHT + PADDING + BALL_RADIUS) {
  const left = PADDING + BALL_RADIUS;
  const right = canvasWidth - PADDING - BALL_RADIUS;
  const top = topBound;

  if (ball.vy > 0) {
    let t = (paddleY - ball.y - BALL_RADIUS) / ball.vy;
    if (t <= 0) return ball.x;
    let x = ball.x;
    let vx = ball.vx;
    while (t > 0) {
      const toWall = vx > 0 ? (right - x) / vx : vx < 0 ? (left - x) / vx : Infinity;
      if (!isFinite(toWall) || toWall >= t) {
        return Math.max(left, Math.min(right, x + vx * t));
      }
      t -= toWall;
      x += vx * toWall;
      vx = -vx;
    }
    return Math.max(left, Math.min(right, x));
  }

  // Ball rising — simulate forward until it returns to the paddle
  let x = ball.x;
  let y = ball.y;
  let vx = ball.vx;
  let vy = ball.vy;
  for (let i = 0; i < 600; i++) {
    if (vy > 0 && y + BALL_RADIUS >= paddleY - 0.5) {
      return Math.max(left, Math.min(right, x));
    }
    x += vx;
    y += vy;
    if (x < left) { x = left; vx = Math.abs(vx); }
    else if (x > right) { x = right; vx = -Math.abs(vx); }
    if (y < top) { y = top; vy = Math.abs(vy); }
  }
  return Math.max(left, Math.min(right, x));
}

function paddleCanReach(paddleX, paddleWidth, targetCenterX, canvasWidth, framesLeft, boost = 1) {
  const targetX = clampPaddleX(targetCenterX - paddleWidth / 2, paddleWidth, canvasWidth);
  const dist = Math.abs(targetX - paddleX);
  return dist <= PADDLE_MAX_SPEED * boost * framesLeft + paddleWidth * 0.15;
}

/**
 * @param {PowerUp[]} powerUps
 * @param {Ball[]} balls
 * @param {number} paddleX
 * @param {number} paddleY
 * @param {number} paddleWidth
 * @param {number} canvasWidth
 * @param {number} paddleContactY
 * @param {number} topBound
 * @param {number} [saveBoost]
 */
function getPaddleTarget(powerUps, balls, paddleX, paddleY, paddleWidth, canvasWidth, paddleContactY, topBound, saveBoost = 1) {
  const fallPerFrame = POWERUP_FALL_SPEED * SUB_STEPS;
  const center = canvasWidth / 2 - paddleWidth / 2;

  const alive = balls.filter((b) => b.alive);
  const threats = alive
    .filter((b) => b.vy > 0 && b.y < paddleContactY)
    .map((b) => ({
      ball: b,
      time: (paddleContactY - b.y) / Math.max(b.vy, 0.1),
      intercept: predictBallInterceptX(b, paddleY, canvasWidth, topBound),
    }))
    .sort((a, b) => a.time - b.time);

  // Always prioritize saving the closest falling ball
  if (threats.length > 0) {
    const closest = threats[0];
    return { x: closest.intercept - paddleWidth / 2 };
  }

  // Power-ups only when no ball is falling toward the paddle
  let bestPu = /** @type {PowerUp | null} */ (null);
  let bestPuFrames = Infinity;
  for (const pu of powerUps) {
    if (pu.y >= paddleY - 2) continue;
    const frames = (paddleY - pu.y) / fallPerFrame;
    if (frames > POWERUP_CHASE_FRAMES) continue;
    if (!paddleCanReach(paddleX, paddleWidth, pu.x, canvasWidth, frames, saveBoost)) continue;
    if (frames < bestPuFrames) {
      bestPuFrames = frames;
      bestPu = pu;
    }
  }

  if (bestPu) {
    return { x: bestPu.x - paddleWidth / 2 };
  }

  const lead = alive[0];
  if (lead) {
    const targetX = lead.x - paddleWidth / 2;
    const dist = Math.abs(clampPaddleX(targetX, paddleWidth, canvasWidth) - paddleX);
    if (dist < canvasWidth * 0.4) {
      return { x: targetX };
    }
  }

  return { x: center };
}

function clampPaddleX(x, paddleWidth, canvasWidth) {
  return Math.max(PADDING, Math.min(canvasWidth - PADDING - paddleWidth, x));
}
function sparseKeyframes(states, getValue) {
  /** @type {{ f: number, v: number }[]} */
  const changes = [];
  let prev = /** @type {number | null} */ (null);
  for (let f = 0; f < states.length; f++) {
    const v = getValue(f);
    if (prev === null || v !== prev) {
      changes.push({ f, v });
      prev = v;
    }
  }
  if (changes.length <= 1) return null;
  const denom = states.length - 1;
  return {
    keyTimes: changes.map((c) => (c.f / denom).toFixed(4)).join(";"),
    values: changes.map((c) => c.v).join(";"),
  };
}

function buildTextSegments(states, getText) {
  /** @type {{ start: number, end: number, text: string }[]} */
  const segments = [];
  let prev = /** @type {string | null} */ (null);
  let start = 0;
  for (let f = 0; f < states.length; f++) {
    const text = getText(f);
    if (text !== prev) {
      if (prev !== null) segments.push({ start, end: f - 1, text: prev });
      start = f;
      prev = text;
    }
  }
  if (prev !== null) segments.push({ start, end: states.length - 1, text: prev });
  return segments;
}

function buildSegmentedText(segments, x, y, fill, duration, stateCount, anchor = "start") {
  const denom = Math.max(stateCount - 1, 1);
  return segments.map((seg) => {
    const t0 = (seg.start / denom).toFixed(4);
    const t1 = (seg.end / denom).toFixed(4);
    const isFirst = seg.start === 0;
    const isLast = seg.end === stateCount - 1;
    const anchorAttr = anchor !== "start" ? ` text-anchor="${anchor}"` : "";
    if (isFirst && isLast) {
      return `<text x="${x}" y="${y}" font-size="9" font-family="monospace" font-weight="bold" fill="${fill}"${anchorAttr}>${seg.text}</text>`;
    }
    let keyTimes;
    let values;
    if (isFirst) {
      keyTimes = `0;${t1};${t1};1`;
      values = "1;1;0;0";
    } else if (isLast) {
      keyTimes = `0;${t0};${t0};1`;
      values = "0;0;1;1";
    } else {
      keyTimes = `0;${t0};${t0};${t1};${t1};1`;
      values = "0;0;1;1;0;0";
    }
    return `<text x="${x}" y="${y}" font-size="9" font-family="monospace" font-weight="bold" fill="${fill}"${anchorAttr} opacity="0">${seg.text}<animate attributeName="opacity" values="${values}" keyTimes="${keyTimes}" dur="${duration}s" repeatCount="indefinite"/></text>`;
  }).join("");
}

function buildPowerUpEl(lc, duration) {
  const { type, xs, ys, opacity, xpValue } = lc;
  const meta = type === "xp"
    ? { label: `+${xpValue ?? 0}`, color: XP_POWERUP_COLOR }
    : POWERUP_META[type];
  const half = POWERUP_SIZE / 2;

  const visible = opacity.some((o) => o === 1);
  if (!visible) return "";

  const xAnim = xs.map((x) => (x > 0 ? x - half : -100).toFixed(1));
  const yAnim = ys.map((y) => (y > 0 ? y - half : -100).toFixed(1));

  return `<g><rect width="${POWERUP_SIZE}" height="${POWERUP_SIZE}" rx="2" fill="${meta.color}" stroke="#000" stroke-width="0.5" opacity="${opacity[0]}"><animate attributeName="x" values="${xAnim.join(";")}" dur="${duration}s" repeatCount="indefinite"/><animate attributeName="y" values="${yAnim.join(";")}" dur="${duration}s" repeatCount="indefinite"/><animate attributeName="opacity" values="${opacity.join(";")}" dur="${duration}s" repeatCount="indefinite"/></rect><text font-size="8" font-weight="bold" font-family="monospace" fill="#111" text-anchor="middle" dominant-baseline="middle" opacity="${opacity[0]}">${meta.label}<animate attributeName="x" values="${xs.map((x) => (x > 0 ? x : -100).toFixed(1)).join(";")}" dur="${duration}s" repeatCount="indefinite"/><animate attributeName="y" values="${ys.map((y) => (y > 0 ? y + 1 : -100).toFixed(1)).join(";")}" dur="${duration}s" repeatCount="indefinite"/><animate attributeName="opacity" values="${opacity.join(";")}" dur="${duration}s" repeatCount="indefinite"/></text></g>`;
}

function animValues(arr) {
  return arr.map((v) => v.toFixed(1)).join(";");
}

function minifySVG(svg) {
  return svg.replace(/\s{2,}/g, " ").replace(/>\s+</g, "><").replace(/\n/g, "");
}

/**
 * @param {({ level: number, contributionCount: number } | null)[][]} days
 * @param {{ bg: string, paddle: string, ball: string, bricks: import("./themes.mjs").ColorPalette }} themeColors
 * @param {boolean} enableGhostBricks
 * @param {number} seed
 */
function buildSVG(days, themeColors, enableGhostBricks, seed) {
  const brickColumnCount = days.length;
  const canvasWidth = brickColumnCount * (BRICK_SIZE + BRICK_GAP) + PADDING * 2 - BRICK_GAP;
  const bricksTotalHeight = 7 * (BRICK_SIZE + BRICK_GAP) - BRICK_GAP;
  const paddleY = HUD_HEIGHT + PADDING + bricksTotalHeight + PADDLE_BRICK_GAP;
  const canvasHeight = paddleY + PADDLE_HEIGHT + BALL_RADIUS + 4;
  const hudText = themeColors.hudText ?? themeColors.paddle;

  const palette = themeColors.bricks;

  /** @type {Brick[]} */
  const bricks = [];
  for (let c = 0; c < brickColumnCount; c++) {
    for (let r = 0; r < 7; r++) {
      const day = days[c]?.[r];
      if (!day) continue;
      bricks.push({
        x: c * (BRICK_SIZE + BRICK_GAP) + PADDING,
        y: HUD_HEIGHT + r * (BRICK_SIZE + BRICK_GAP) + PADDING,
        colorClass: `c${day.level}`,
        status: "visible",
        hasCommit: day.contributionCount > 0,
        contributionCount: day.contributionCount,
        level: day.level,
        index: bricks.length,
      });
    }
  }

  const paddleContactY = paddleY - BALL_RADIUS;

  const states = simulate(bricks, canvasWidth, canvasHeight, paddleY, enableGhostBricks, seed);
  if (states.length < 2) throw new Error("Simulation produced too few frames");

  const duration = states.length * SECONDS_PER_FRAME;

  const paddleXs = states.map((s) => s.paddleX);
  const paddleWidths = states.map((s) => s.paddleWidth);

  const brickAnimData = bricks.map((_, i) => {
    let firstHidden = -1;
    for (let f = 0; f < states.length; f++) {
      if (states[f].bricks[i] !== "visible") { firstHidden = f; break; }
    }
    if (firstHidden === -1) return { animate: false };
    const t = firstHidden / (states.length - 1);
    return { animate: true, firstZero: firstHidden, keyTimes: `0;${t.toFixed(4)};${t.toFixed(4)};1`, values: "1;1;0;0" };
  });

  const style = `<style>.bg{fill:${themeColors.bg}}${palette.map((c, i) => `.c${i}{fill:${c}}`).join("")}</style>`;
  const brickSymbol = `<defs><symbol id="brick"><rect width="${BRICK_SIZE}" height="${BRICK_SIZE}" rx="${BRICK_RADIUS}"/></symbol></defs>`;

  const brickUses = bricks.map((brick, i) => {
    const anim = brickAnimData[i];
    const level = parseInt(brick.colorClass.slice(1), 10);
    const origColor = palette[level] ?? palette[0];
    const ghostColor = palette[0];

    if (enableGhostBricks && anim.animate) {
      const t = anim.firstZero / (states.length - 1);
      return `<use href="#brick" x="${brick.x}" y="${brick.y}" fill="${origColor}"><animate attributeName="fill" values="${origColor};${origColor};${ghostColor};${ghostColor}" keyTimes="0;${t.toFixed(4)};${t.toFixed(4)};1" dur="${duration}s" fill="freeze" repeatCount="indefinite"/></use>`;
    }
    if (anim.animate) {
      return `<use href="#brick" x="${brick.x}" y="${brick.y}" class="${brick.colorClass}"><animate attributeName="opacity" values="${anim.values}" keyTimes="${anim.keyTimes}" dur="${duration}s" fill="freeze" repeatCount="indefinite"/></use>`;
    }
    return `<use href="#brick" x="${brick.x}" y="${brick.y}" class="${brick.colorClass}"/>`;
  }).join("");

  const paddle = `<g transform="translate(0,${paddleY})"><rect y="0" height="${PADDLE_HEIGHT}" rx="${PADDLE_RADIUS}" fill="${themeColors.paddle}"><animate attributeName="x" values="${animValues(paddleXs)}" dur="${duration}s" repeatCount="indefinite"/><animate attributeName="width" values="${animValues(paddleWidths)}" dur="${duration}s" repeatCount="indefinite"/></rect></g>`;

  /** @type {string[]} */
  const ballEls = [];
  for (let slot = 0; slot < MAX_BALLS; slot++) {
    const cx = states.map((s) => s.balls[slot].x);
    const cy = states.map((s) => {
      const ball = s.balls[slot];
      return ball.alive ? ball.y : -100;
    });
    const opacityAnim = sparseKeyframes(states, (f) => (states[f].balls[slot].alive ? 1 : 0));
    const opacityAttr = opacityAnim
      ? `<animate attributeName="opacity" values="${opacityAnim.values}" keyTimes="${opacityAnim.keyTimes}" dur="${duration}s" repeatCount="indefinite"/>`
      : "";
    const initialOpacity = states[0].balls[slot].alive ? 1 : 0;
    ballEls.push(`<circle r="${BALL_RADIUS}" fill="${themeColors.ball}" opacity="${initialOpacity}"><animate attributeName="cx" values="${animValues(cx)}" dur="${duration}s" repeatCount="indefinite"/><animate attributeName="cy" values="${animValues(cy)}" dur="${duration}s" repeatCount="indefinite"/>${opacityAttr}</circle>`);
  }

  /** @type {Map<number, { type: PowerUpType, xs: number[], ys: number[], opacity: number[] }>} */
  const puLifecycles = new Map();
  const knownIds = new Set();

  for (let f = 0; f < states.length; f++) {
    for (const pu of states[f].powerUps) knownIds.add(pu.id);

    for (const id of knownIds) {
      if (!puLifecycles.has(id)) {
        const pu = states[f].powerUps.find((p) => p.id === id);
        if (!pu) continue;
        puLifecycles.set(id, {
          type: pu.type,
          xpValue: pu.xpValue,
          xs: new Array(states.length).fill(-100),
          ys: new Array(states.length).fill(-100),
          opacity: new Array(states.length).fill(0),
        });
      }
      const lc = puLifecycles.get(id);
      const pu = states[f].powerUps.find((p) => p.id === id);
      if (pu) {
        lc.xs[f] = pu.x;
        lc.ys[f] = pu.y;
        lc.opacity[f] = 1;
      } else if (f > 0) {
        lc.opacity[f] = 0;
      }
    }
  }

  const powerUpEls = [...puLifecycles.values()].map((lc) => buildPowerUpEl(lc, duration)).join("");

  const livesSegments = buildTextSegments(states, (f) => {
    const s = states[f];
    const hearts = "♥".repeat(s.lives) + "♡".repeat(Math.max(0, STARTING_LIVES - s.lives));
    return s.gameOver ? `${hearts} GAME OVER` : hearts;
  });
  const scoreSegments = buildTextSegments(states, (f) => `${states[f].score} pts`);
  const xpSegments = buildTextSegments(states, (f) => `XP ${states[f].xp}`);

  const hud = `<g>${buildSegmentedText(livesSegments, PADDING, 11, hudText, duration, states.length)}${buildSegmentedText(scoreSegments, canvasWidth - PADDING, 11, hudText, duration, states.length, "end")}${buildSegmentedText(xpSegments, canvasWidth / 2, 11, hudText, duration, states.length, "middle")}</g>`;

  return minifySVG(`<svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg"><rect class="bg" width="100%" height="100%"/>${style}${hud}${brickSymbol}${brickUses}${ballEls.join("")}${paddle}${powerUpEls}</svg>`);
}

async function main() {
  const username = process.env.GITHUB_USERNAME || process.argv[2];
  const token = process.env.GITHUB_TOKEN || process.argv[3];
  const outputPath = process.env.OUTPUT_PATH || "./output";

  if (!username || !token) {
    console.error("Usage: GITHUB_USERNAME=... GITHUB_TOKEN=... node scripts/generate-breakout.mjs");
    process.exit(1);
  }

  console.log(`Fetching contributions for ${username}...`);
  const days = await fetchContributions(username, token);
  const seed = days.reduce((acc, week) => acc + week.reduce((w, d) => w + (d?.contributionCount ?? 0), 0), 0);
  const runSeed = seed ^ (Date.now() % 100000);

  mkdirSync(outputPath, { recursive: true });

  for (const [themeId, theme] of Object.entries(THEMES)) {
    for (const mode of ["light", "dark"]) {
      const filename = `breakout-${themeId}-${mode}.svg`;
      console.log(`Generating ${filename}...`);
      const svg = buildSVG(days, theme[mode], true, runSeed + themeId.length * 31 + mode.length);
      writeFileSync(join(outputPath, filename), svg);
    }
  }

  copyFileSync(join(outputPath, "breakout-github-light.svg"), join(outputPath, "breakout-light.svg"));
  copyFileSync(join(outputPath, "breakout-github-dark.svg"), join(outputPath, "breakout-dark.svg"));
  console.log(`Done! Generated ${Object.keys(THEMES).length * 2} themed SVGs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
