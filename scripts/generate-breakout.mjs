import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { THEMES } from "./themes.mjs";

// Layout
const PADDING = 15;
const PADDLE_WIDTH = 75;
const PADDLE_HEIGHT = 10;
const PADDLE_RADIUS = 5;
const PADDLE_BRICK_GAP = 100;
const BALL_RADIUS = 8;
const BRICK_SIZE = 12;
const BRICK_GAP = 3;
const BRICK_RADIUS = 3;

// Simulation
const BALL_SPEED = 9;
const SUB_STEPS = 6;
const SECONDS_PER_FRAME = 1 / 30;
const FRAME_SAMPLE = 2; // sample every N simulation frames for smaller SVGs
const MAX_FRAMES = 40000;
const MIN_BOUNCE_ANGLE = 0.35; // radians (~20°) — prevents vertical/horizontal trap loops
const MIN_VX_RATIO = Math.sin(MIN_BOUNCE_ANGLE);
const MIN_VY_RATIO = Math.sin(MIN_BOUNCE_ANGLE);

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
                color
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

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GitHub GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  const weeks =
    json.data.user.contributionsCollection.contributionCalendar.weeks;

  /** @type {(import("./themes.mjs").ColorPalette | { level: number, contributionCount: number } | null)[][]} */
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

/**
 * @param {number} vx
 * @param {number} vy
 * @param {number} speed
 */
function normalizeVelocity(vx, vy, speed) {
  const mag = Math.hypot(vx, vy);
  if (mag < 1e-6) return { vx: 0, vy: -speed };
  return { vx: (vx / mag) * speed, vy: (vy / mag) * speed };
}

/**
 * Keep speed constant while ensuring the ball never travels too vertically
 * or too horizontally (either causes infinite bounce loops).
 * @param {number} vx
 * @param {number} vy
 * @param {number} speed
 * @param {number} [biasX=0] deterministic horizontal sign when vx is ~0
 */
function clampVelocity(vx, vy, speed, biasX = 0) {
  let nvx = vx;
  let nvy = vy;

  const minVx = speed * MIN_VX_RATIO;
  const minVy = speed * MIN_VY_RATIO;

  // Prevent vertical trap loops (vx ≈ 0)
  if (Math.abs(nvx) < minVx) {
    const sign = nvx !== 0 ? Math.sign(nvx) : (biasX !== 0 ? Math.sign(biasX) : 1);
    nvx = sign * minVx;
    nvy = Math.sign(nvy || -1) * Math.sqrt(speed * speed - nvx * nvx);
  }

  // Prevent horizontal trap loops (vy ≈ 0)
  if (Math.abs(nvy) < minVy) {
    const sign = nvy !== 0 ? Math.sign(nvy) : -1;
    nvy = sign * minVy;
    nvx = Math.sign(nvx || 1) * Math.sqrt(speed * speed - nvy * nvy);
  }

  return normalizeVelocity(nvx, nvy, speed);
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} rx
 * @param {number} ry
 * @param {number} rw
 * @param {number} rh
 * @param {number} prevCx
 * @param {number} prevCy
 */
function circleRectCollisionSide(cx, cy, r, rx, ry, rw, rh, prevCx, prevCy) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  if (dx * dx + dy * dy > r * r) return null;

  const wasLeft = prevCx + r <= rx;
  const wasRight = prevCx - r >= rx + rw;
  const wasAbove = prevCy + r <= ry;
  const wasBelow = prevCy - r >= ry + rh;

  const overlapLeft = cx + r - rx;
  const overlapRight = rx + rw - (cx - r);
  const overlapTop = cy + r - ry;
  const overlapBottom = ry + rh - (cy - r);

  if (wasAbove && overlapTop < overlapBottom) return "top";
  if (wasBelow && overlapBottom < overlapTop) return "bottom";
  if (wasLeft && overlapLeft < overlapRight) return "left";
  if (wasRight && overlapRight < overlapLeft) return "right";

  const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
  if (minOverlap === overlapTop) return "top";
  if (minOverlap === overlapBottom) return "bottom";
  if (minOverlap === overlapLeft) return "left";
  return "right";
}

/**
 * @typedef {{ x: number, y: number, status: "visible" | "hidden", colorClass: string, hasCommit: boolean }} Brick
 * @typedef {{ ballX: number, ballY: number, paddleX: number, bricks: ("visible" | "hidden")[] }} FrameState
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
  let ballX = canvasWidth / 2;
  let ballY = canvasHeight - 30;

  const launchAngle = -Math.PI / 4 + ((seed % 7) - 3) * 0.04;
  let ballVx = BALL_SPEED * Math.cos(launchAngle);
  let ballVy = BALL_SPEED * Math.sin(launchAngle);

  const simulatedBricks = bricks.map((b) => ({ ...b }));
  /** @type {FrameState[]} */
  const frameHistory = [];
  let paddleX = (canvasWidth - PADDLE_WIDTH) / 2;
  let frame = 0;
  let verticalTrapFrames = 0;

  const breakable = (/** @type {Brick} */ b) =>
    b.status === "visible" && (!enableGhostBricks || b.hasCommit);

  while (
    simulatedBricks.some(breakable) &&
    frame < MAX_FRAMES
  ) {
    // Predictive paddle — lead the ball slightly for smoother tracking
    const targetX = ballX + ballVx * 3 - PADDLE_WIDTH / 2;
    const clampedTarget = Math.max(
      PADDING,
      Math.min(canvasWidth - PADDING - PADDLE_WIDTH, targetX),
    );
    paddleX += (clampedTarget - paddleX) * 0.18;

    const stepVx = ballVx / SUB_STEPS;
    const stepVy = ballVy / SUB_STEPS;

    for (let sub = 0; sub < SUB_STEPS; sub++) {
      const prevX = ballX;
      const prevY = ballY;

      ballX += stepVx;
      ballY += stepVy;

      // Wall collisions
      if (ballX - BALL_RADIUS < PADDING) {
        ballX = PADDING + BALL_RADIUS;
        ballVx = Math.abs(ballVx);
        ({ vx: ballVx, vy: ballVy } = clampVelocity(ballVx, ballVy, BALL_SPEED, 1));
      } else if (ballX + BALL_RADIUS > canvasWidth - PADDING) {
        ballX = canvasWidth - PADDING - BALL_RADIUS;
        ballVx = -Math.abs(ballVx);
        ({ vx: ballVx, vy: ballVy } = clampVelocity(ballVx, ballVy, BALL_SPEED, -1));
      }

      if (ballY - BALL_RADIUS < PADDING) {
        ballY = PADDING + BALL_RADIUS;
        ballVy = Math.abs(ballVy);
        ({ vx: ballVx, vy: ballVy } = clampVelocity(ballVx, ballVy, BALL_SPEED, ballX - canvasWidth / 2));
      }

      // Paddle collision with angle-based reflection
      if (
        ballVy > 0 &&
        circleRectCollisionSide(
          ballX,
          ballY,
          BALL_RADIUS,
          paddleX,
          paddleY,
          PADDLE_WIDTH,
          PADDLE_HEIGHT,
          prevX,
          prevY,
        )
      ) {
        const hitPos = Math.max(0.05, Math.min(0.95, (ballX - paddleX) / PADDLE_WIDTH));
        const maxDeflection = Math.PI * 0.4;
        let angle = (hitPos - 0.5) * maxDeflection * 2;
        if (Math.abs(angle) < MIN_BOUNCE_ANGLE) {
          angle = Math.sign(angle || (ballX - paddleX - PADDLE_WIDTH / 2) || 1) * MIN_BOUNCE_ANGLE;
        }
        ballVx = BALL_SPEED * Math.sin(angle);
        ballVy = -BALL_SPEED * Math.cos(angle);
        ballY = paddleY - BALL_RADIUS - 0.5;
        ({ vx: ballVx, vy: ballVy } = clampVelocity(ballVx, ballVy, BALL_SPEED, ballX - paddleX - PADDLE_WIDTH / 2));
      }

      // Brick collisions — resolve one per sub-step
      for (let i = 0; i < simulatedBricks.length; i++) {
        const brick = simulatedBricks[i];
        if (!breakable(brick)) continue;

        const side = circleRectCollisionSide(
          ballX,
          ballY,
          BALL_RADIUS,
          brick.x,
          brick.y,
          BRICK_SIZE,
          BRICK_SIZE,
          prevX,
          prevY,
        );

        if (!side) continue;

        if (side === "top" || side === "bottom") {
          ballVy = -ballVy;
          ballY = side === "top" ? brick.y - BALL_RADIUS - 0.5 : brick.y + BRICK_SIZE + BALL_RADIUS + 0.5;
        } else {
          ballVx = -ballVx;
          ballX = side === "left" ? brick.x - BALL_RADIUS - 0.5 : brick.x + BRICK_SIZE + BALL_RADIUS + 0.5;
        }

        brick.status = "hidden";
        ({ vx: ballVx, vy: ballVy } = clampVelocity(ballVx, ballVy, BALL_SPEED, ballX - (brick.x + BRICK_SIZE / 2)));
        break;
      }

      // Clamp position
      ballX = Math.max(PADDING + BALL_RADIUS, Math.min(canvasWidth - PADDING - BALL_RADIUS, ballX));
      ballY = Math.max(PADDING + BALL_RADIUS, Math.min(canvasHeight - PADDING - BALL_RADIUS, ballY));
    }

    // Escape vertical trap: ball bouncing in place with negligible horizontal movement
    if (Math.abs(ballVx) < BALL_SPEED * MIN_VX_RATIO * 1.1) {
      verticalTrapFrames++;
      if (verticalTrapFrames > 30) {
        const nudge = verticalTrapFrames % 2 === 0 ? 1 : -1;
        ({ vx: ballVx, vy: ballVy } = clampVelocity(nudge * BALL_SPEED * MIN_VX_RATIO, ballVy, BALL_SPEED, nudge));
        verticalTrapFrames = 0;
      }
    } else {
      verticalTrapFrames = 0;
    }

    if (frame % FRAME_SAMPLE === 0) {
      frameHistory.push({
        ballX,
        ballY,
        paddleX,
        bricks: simulatedBricks.map((b) => b.status),
      });
    }

    frame++;
  }

  return frameHistory;
}

/** @param {number[]} arr */
function animValues(arr) {
  return arr.map((v) => v.toFixed(1)).join(";");
}

/** @param {string} svg */
function minifySVG(svg) {
  return svg.replace(/\s{2,}/g, " ").replace(/>\s+</g, "><").replace(/\n/g, "");
}

/**
 * @param {ReturnType<typeof fetchContributions> extends Promise<infer T> ? T : never} days
 * @param {import("./themes.mjs").ColorPalette} colorPalette
 * @param {{ bg: string, paddle: string, ball: string, bricks: import("./themes.mjs").ColorPalette }} themeColors
 * @param {boolean} enableGhostBricks
 * @param {number} seed
 */
function buildSVG(days, colorPalette, themeColors, enableGhostBricks, seed) {
  const brickColumnCount = days.length;
  const canvasWidth =
    brickColumnCount * (BRICK_SIZE + BRICK_GAP) + PADDING * 2 - BRICK_GAP;
  const bricksTotalHeight = 7 * (BRICK_SIZE + BRICK_GAP) - BRICK_GAP;
  const paddleY = PADDING + bricksTotalHeight + PADDLE_BRICK_GAP;
  const canvasHeight = paddleY + PADDLE_HEIGHT + PADDING + 20;

  const palette = themeColors.bricks;

  /** @type {Brick[]} */
  const bricks = [];
  for (let c = 0; c < brickColumnCount; c++) {
    for (let r = 0; r < 7; r++) {
      const day = days[c]?.[r];
      if (!day) continue;
      bricks.push({
        x: c * (BRICK_SIZE + BRICK_GAP) + PADDING,
        y: r * (BRICK_SIZE + BRICK_GAP) + PADDING,
        colorClass: `c${day.level}`,
        status: "visible",
        hasCommit: day.contributionCount > 0,
      });
    }
  }

  const states = simulate(
    bricks,
    canvasWidth,
    canvasHeight,
    paddleY,
    enableGhostBricks,
    seed,
  );

  if (states.length < 2) {
    throw new Error("Simulation produced too few frames");
  }

  const duration = states.length * SECONDS_PER_FRAME;
  const ballX = states.map((s) => s.ballX);
  const ballY = states.map((s) => s.ballY);
  const paddleXs = states.map((s) => s.paddleX);

  const brickAnimData = bricks.map((_, i) => {
    let firstHidden = -1;
    for (let f = 0; f < states.length; f++) {
      if (states[f].bricks[i] !== "visible") {
        firstHidden = f;
        break;
      }
    }
    if (firstHidden === -1) return { animate: false };
    const t = firstHidden / (states.length - 1);
    return {
      animate: true,
      firstZero: firstHidden,
      keyTimes: `0;${t.toFixed(4)};${t.toFixed(4)};1`,
      values: "1;1;0;0",
    };
  });

  const style = `<style>
    .bg{fill:${themeColors.bg}}
    ${palette.map((color, i) => `.c${i}{fill:${color}}`).join("")}
  </style>`;

  const brickSymbol = `<defs><symbol id="brick"><rect width="${BRICK_SIZE}" height="${BRICK_SIZE}" rx="${BRICK_RADIUS}"/></symbol></defs>`;

  const brickUses = bricks
    .map((brick, i) => {
      const anim = brickAnimData[i];
      const level = parseInt(brick.colorClass.slice(1), 10);
      const origColor = palette[level] ?? palette[0];
      const ghostColor = palette[0];

      if (enableGhostBricks && anim.animate) {
        const t = anim.firstZero / (states.length - 1);
        return `<use href="#brick" x="${brick.x}" y="${brick.y}" fill="${origColor}">
          <animate attributeName="fill" values="${origColor};${origColor};${ghostColor};${ghostColor}"
            keyTimes="0;${t.toFixed(4)};${t.toFixed(4)};1"
            dur="${duration}s" fill="freeze" repeatCount="indefinite"/>
        </use>`;
      }

      if (anim.animate) {
        return `<use href="#brick" x="${brick.x}" y="${brick.y}" class="${brick.colorClass}">
          <animate attributeName="opacity" values="${anim.values}" keyTimes="${anim.keyTimes}"
            dur="${duration}s" fill="freeze" repeatCount="indefinite"/>
        </use>`;
      }

      return `<use href="#brick" x="${brick.x}" y="${brick.y}" class="${brick.colorClass}"/>`;
    })
    .join("");

  const paddle = `<g transform="translate(0,${paddleY})">
    <rect y="0" width="${PADDLE_WIDTH}" height="${PADDLE_HEIGHT}" rx="${PADDLE_RADIUS}" fill="${themeColors.paddle}">
      <animate attributeName="x" values="${animValues(paddleXs)}" dur="${duration}s" repeatCount="indefinite"/>
    </rect>
  </g>`;

  const ball = `<circle r="${BALL_RADIUS}" fill="${themeColors.ball}">
    <animate attributeName="cx" values="${animValues(ballX)}" dur="${duration}s" repeatCount="indefinite"/>
    <animate attributeName="cy" values="${animValues(ballY)}" dur="${duration}s" repeatCount="indefinite"/>
  </circle>`;

  return minifySVG(
    `<svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect class="bg" width="100%" height="100%"/>
      ${style}${brickSymbol}${brickUses}${paddle}${ball}
    </svg>`,
  );
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

  const seed = days.reduce((acc, week) => {
    return acc + week.reduce((w, d) => w + (d?.contributionCount ?? 0), 0);
  }, 0);

  mkdirSync(outputPath, { recursive: true });

  for (const [themeId, theme] of Object.entries(THEMES)) {
    for (const mode of ["light", "dark"]) {
      const colors = theme[mode];
      const filename = `breakout-${themeId}-${mode}.svg`;
      console.log(`Generating ${filename}...`);

      const svg = buildSVG(days, colors.bricks, colors, true, seed + themeId.length);
      writeFileSync(join(outputPath, filename), svg);
    }
  }

  // Legacy filenames for backward compatibility
  copyFileSync(join(outputPath, "breakout-github-light.svg"), join(outputPath, "breakout-light.svg"));
  copyFileSync(join(outputPath, "breakout-github-dark.svg"), join(outputPath, "breakout-dark.svg"));

  console.log(`Done! Generated ${Object.keys(THEMES).length * 2} themed SVGs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
