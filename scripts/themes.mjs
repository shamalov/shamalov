/** @typedef {[string, string, string, string, string]} ColorPalette */

/** @type {Record<string, { name: string, light: { bg: string, paddle: string, ball: string, bricks: ColorPalette }, dark: { bg: string, paddle: string, ball: string, bricks: ColorPalette } }>} */
export const THEMES = {
  github: {
    name: "GitHub",
    light: {
      bg: "#ffffff",
      paddle: "#1F6FEB",
      ball: "#1F6FEB",
      bricks: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    },
    dark: {
      bg: "#0d1117",
      paddle: "#58A6FF",
      ball: "#58A6FF",
      bricks: ["#161b22", "#033a16", "#196c2e", "#2ea043", "#56d364"],
    },
  },
  neon: {
    name: "Neon",
    light: {
      bg: "#0a0a12",
      paddle: "#ff00ff",
      ball: "#00ffff",
      bricks: ["#1a1a2e", "#ff00ff", "#00ffff", "#ff6b35", "#f7ff00"],
    },
    dark: {
      bg: "#050508",
      paddle: "#ff00ff",
      ball: "#00ffff",
      bricks: ["#0d0d1a", "#cc00cc", "#00cccc", "#cc5528", "#c7cc00"],
    },
  },
  ocean: {
    name: "Ocean",
    light: {
      bg: "#e8f4f8",
      paddle: "#0077b6",
      ball: "#00b4d8",
      bricks: ["#caf0f8", "#90e0ef", "#48cae4", "#0096c7", "#023e8a"],
    },
    dark: {
      bg: "#03045e",
      paddle: "#48cae4",
      ball: "#90e0ef",
      bricks: ["#03045e", "#0077b6", "#0096c7", "#00b4d8", "#48cae4"],
    },
  },
  sunset: {
    name: "Sunset",
    light: {
      bg: "#fff5eb",
      paddle: "#e76f51",
      ball: "#f4a261",
      bricks: ["#fef3e2", "#fcd5b5", "#f4a261", "#e76f51", "#c1121f"],
    },
    dark: {
      bg: "#1a0a00",
      paddle: "#f4a261",
      ball: "#e9c46a",
      bricks: ["#2d1810", "#8b4513", "#c1121f", "#e76f51", "#f4a261"],
    },
  },
  retro: {
    name: "Retro",
    light: {
      bg: "#1a1a2e",
      paddle: "#e94560",
      ball: "#f5f5f5",
      bricks: ["#16213e", "#e94560", "#0f3460", "#533483", "#f5f5f5"],
    },
    dark: {
      bg: "#0f0f1a",
      paddle: "#e94560",
      ball: "#eaeaea",
      bricks: ["#0f0f1a", "#c73e54", "#0a2342", "#3d2766", "#d4d4d4"],
    },
  },
};
