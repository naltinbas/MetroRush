import * as THREE from 'three';

/**
 * All textures are drawn on canvases at startup. Nothing is loaded from disk
 * or the network.
 */

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return [c, ctx];
}

function hashNoise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Grainy concrete/metal deck surface. */
export function makeDeckTexture(size = 256): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = hashNoise(x >> 1, y >> 1, 7) * 0.5 + hashNoise(x >> 3, y >> 3, 11) * 0.5;
      const v = 120 + n * 60;
      const i = (y * size + x) * 4;
      img.data[i] = v * 0.9;
      img.data[i + 1] = v * 0.95;
      img.data[i + 2] = v * 1.08;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Panel seams
  ctx.strokeStyle = 'rgba(20,24,40,0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= size; i += size / 2) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Lit-window pattern used as an emissive map on skyline buildings. */
export function makeWindowTexture(size = 128, seed = 3): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const cols = 8;
  const rows = 12;
  const cw = size / cols;
  const rh = size / rows;
  const palette = ['#ffd27a', '#ffb45c', '#8de1ff', '#c9a6ff', '#fff6d6'];
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const n = hashNoise(col, r, seed);
      if (n < 0.55) continue;
      const bright = 0.5 + hashNoise(col + 9, r + 3, seed) * 0.5;
      ctx.globalAlpha = bright;
      ctx.fillStyle = palette[Math.floor(hashNoise(col + 21, r + 7, seed) * palette.length)];
      ctx.fillRect(col * cw + cw * 0.22, r * rh + rh * 0.25, cw * 0.56, rh * 0.5);
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Neon sign with a short label. Used on emissive planes beside the track. */
export function makeSignTexture(text: string, color: string, accent: string, w = 256, h = 96): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = '#07070f';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.font = `bold ${Math.floor(h * 0.42)}px "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2 + 2);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.75;
  ctx.fillText(text, w / 2, h / 2 + 2);
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft blob alpha texture for clouds/fog planes. */
export function makeCloudTexture(size = 256): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const x = hashNoise(i, 1, 5) * size;
    const y = size * 0.3 + hashNoise(i, 2, 5) * size * 0.4;
    const r = size * (0.08 + hashNoise(i, 3, 5) * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Radial glow used for lamp heads, pickups and the magnet aura. */
export function makeGlowTexture(size = 128): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Diagonal hazard stripes for barricades and construction props. */
export function makeStripeTexture(colorA: string, colorB: string, size = 64): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = colorB;
  ctx.lineWidth = 0;
  for (let i = -size; i < size * 2; i += size / 2) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size / 4, 0);
    ctx.lineTo(i + size / 4 + size, size);
    ctx.lineTo(i + size, size);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
