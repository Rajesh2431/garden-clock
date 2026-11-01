// PNG export: flatten the sky, garden and FX canvases and redraw the clock,
// date and weather text on top so the saved image matches the screen.

/**
 * Compose the current scene onto an offscreen canvas.
 *
 * @param {object} scene
 * @param {HTMLElement} scene.stage      Element whose box defines the image size.
 * @param {HTMLElement} scene.timeEl     The clock digits, used for position and font size.
 * @param {HTMLCanvasElement[]} scene.layers  Canvases to draw, bottom first.
 * @param {object} scene.theme           Active theme palette.
 * @param {object} scene.clock           Result of clock.parts().
 * @param {boolean} scene.showSeconds
 * @param {{ temp: number, text: string } | null} scene.weather
 * @param {number} [scene.dpr]
 * @returns {HTMLCanvasElement | null}
 */
export function composeScene({ stage, timeEl, layers, theme, clock, showSeconds, weather, dpr }) {
  const stageRect = stage.getBoundingClientRect();
  const width = Math.round(stageRect.width);
  const height = Math.round(stageRect.height);
  if (!width || !height) return null;
  const ratio = Math.min(dpr || globalThis.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, theme.bg2 || theme.bg);
  gradient.addColorStop(1, theme.bg);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  for (const layer of layers) {
    if (layer) ctx.drawImage(layer, 0, 0, width, height);
  }

  const timeRect = timeEl.getBoundingClientRect();
  const clockX = timeRect.left - stageRect.left + timeRect.width / 2;
  const clockY = timeRect.top - stageRect.top + timeRect.height * 0.55;
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const fontSize =
    Number.parseFloat(getComputedStyle(timeEl).fontSize) || Math.min(width * 0.18, height * 0.3);

  ctx.fillStyle = theme.digit;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `200 ${fontSize}px ${family}`;
  const main = `${clock.hh}:${clock.mm}`;
  const mainWidth = ctx.measureText(main).width;
  const seconds = showSeconds ? clock.ss : '';
  const smallSize = fontSize * 0.2;
  ctx.font = `200 ${smallSize}px ${family}`;
  const secondsWidth = seconds ? ctx.measureText(seconds).width : 0;
  const meridiemWidth = clock.meridiem ? ctx.measureText(clock.meridiem).width + smallSize * 0.4 : 0;
  const gap = fontSize * 0.12;
  const total = mainWidth + (seconds ? gap + secondsWidth : 0) + meridiemWidth;
  let x = clockX - total / 2;
  ctx.font = `200 ${fontSize}px ${family}`;
  ctx.fillText(main, x, clockY);
  x += mainWidth + gap;
  ctx.font = `200 ${smallSize}px ${family}`;
  ctx.globalAlpha = 0.7;
  if (seconds) {
    ctx.fillText(seconds, x, clockY);
    x += secondsWidth + smallSize * 0.4;
  }
  if (clock.meridiem) ctx.fillText(clock.meridiem, x, clockY);
  ctx.globalAlpha = 1;

  const dateSize = Math.max(10, fontSize * 0.12);
  ctx.font = `300 ${dateSize}px ${family}`;
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.78;
  if (typeof ctx.letterSpacing === 'string') ctx.letterSpacing = `${dateSize * 0.28}px`;
  ctx.fillText(`${clock.date.toUpperCase()} · ${clock.tzName}`, clockX, clockY + dateSize * 2.6);
  if (typeof ctx.letterSpacing === 'string') ctx.letterSpacing = '0px';
  ctx.globalAlpha = 1;

  if (weather) {
    const wx = Math.max(22, width * 0.025);
    const wy = Math.max(22, height * 0.035);
    const tempSize = Math.max(22, width * 0.034);
    ctx.textAlign = 'left';
    ctx.font = `200 ${tempSize}px ${family}`;
    ctx.fillText(`${weather.temp}°C`, wx, wy + tempSize);
    ctx.font = `300 ${Math.max(11, width * 0.012)}px ${family}`;
    ctx.globalAlpha = 0.82;
    ctx.fillText(weather.text, wx, wy + Math.max(34, width * 0.048));
    ctx.globalAlpha = 1;
  }
  return canvas;
}

/** Encode a canvas as PNG and trigger a download. Resolves true on success. */
export function downloadCanvas(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(false);
        return;
      }
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      resolve(true);
    }, 'image/png');
  });
}
