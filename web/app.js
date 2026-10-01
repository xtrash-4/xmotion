// =====================================================================
// RETRO Y2K JEDAG-JEDUG STUDIO - ENGINE CORE (60 FPS)
// =====================================================================

const W = 720;
const H = 1280;
const H2 = H / 2;
const TOTAL_TIME_MS1 = 18915;
const TOTAL_TIME_MS2 = 17015;
const TOTAL_TIME_MS3 = (typeof window !== 'undefined' && window.TOTAL_TIME_MS3) ? window.TOTAL_TIME_MS3 : 15215;
let currentPreset = 1;
let TOTAL_TIME_MS = TOTAL_TIME_MS1;

// Elements
const canvas = document.getElementById('jj-canvas');
const ctx = canvas.getContext('2d');
const audio = document.getElementById('audio-player');
const bigPlayBtn = document.getElementById('big-play-btn');
const btnPlayPause = document.getElementById('btn-play-pause');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnReplay = document.getElementById('btn-replay');
const btnMute = document.getElementById('btn-mute');
const iconVol = document.getElementById('icon-vol');
const iconMute = document.getElementById('icon-mute');
const btnLoop = document.getElementById('btn-loop');
const btnFullscreen = document.getElementById('btn-fullscreen');
const timeCurrEl = document.getElementById('time-curr');
const timeTotalEl = document.getElementById('time-total');
const timelineTrack = document.getElementById('timeline-track');
const timelineFill = document.getElementById('timeline-fill');
const timelineThumb = document.getElementById('timeline-thumb');
const beatMarkersLayer = document.getElementById('beat-markers-layer');
const currentSegmentTag = document.getElementById('current-segment-tag');

const btnRender = document.getElementById('btn-render');
const renderProgressBox = document.getElementById('render-progress-box');
const renderStatusText = document.getElementById('render-status-text');
const renderPctText = document.getElementById('render-pct-text');
const progressBarFill = document.getElementById('progress-bar-fill');
const renderBtnText = document.getElementById('render-btn-text');
const btnDefaultPhotos = document.getElementById('btn-default-photos');
const btnSwapPhotos = document.getElementById('btn-swap-photos');

// Catalog & Navigation Elements
const catalogView = document.getElementById('catalog-view');
const studioView = document.getElementById('studio-view');
const catalogGrid = document.getElementById('catalog-grid');
const windowTitleText = document.getElementById('window-title-text');
const btnBackCatalog = document.getElementById('btn-back-catalog');
const activePresetLabel = document.getElementById('active-preset-label');
const btnQuick1 = document.getElementById('btn-quick-1');
const btnQuick2 = document.getElementById('btn-quick-2');
const btnQuick3 = document.getElementById('btn-quick-3');
const catalogPreviewPlayer = document.getElementById('catalog-preview-player');
const y2kToast = document.getElementById('y2k-toast');

// Photo States & Custom Framing
let photo1Img = new Image();
let photo2Img = new Image();
let photo3Img = null;
let photo1Loaded = false;
let photo2Loaded = false;
let photo3Loaded = false;
let photo1Filename = "foto1.jpg";
let photo2Filename = "foto2.jpg";
let photo3Filename = null;

// Custom Framing Configs (Pan X, Pan Y, Zoom)
const photoTransforms = {
  foto1: { x: 0, y: 0, zoom: 1.0 },
  foto2: { x: 0, y: 0, zoom: 1.0 },
  foto3: { x: 0, y: 0, zoom: 1.0 }
};

// Offscreen 2-layar canvases
let canvas2Layar1 = document.createElement('canvas');
canvas2Layar1.width = W;
canvas2Layar1.height = H;
let ctx2Layar1 = canvas2Layar1.getContext('2d');

let canvas2Layar2 = document.createElement('canvas');
canvas2Layar2.width = W;
canvas2Layar2.height = H;
let ctx2Layar2 = canvas2Layar2.getContext('2d');

let canvas2Layar3 = document.createElement('canvas');
canvas2Layar3.width = W;
canvas2Layar3.height = H;
let ctx2Layar3 = canvas2Layar3.getContext('2d');

// Player States
let isPlaying = false;
let isLooping = false;
let isScrubbing = false;
let animFrameId = null;

// =====================================================================
// EASING & BEZIER EVALUATOR (Exact Newton-Raphson)
// =====================================================================
function evalCubicBezier(x1, y1, x2, y2, p) {
  p = Math.max(0.0, Math.min(1.0, p));
  let t = p;
  for (let i = 0; i < 18; i++) {
    const bx = 3.0 * (1.0 - t)**2 * t * x1 + 3.0 * (1.0 - t) * t**2 * x2 + t**3;
    const dbx = 3.0 * (1.0 - t)**2 * x1 + 6.0 * (1.0 - t) * t * (x2 - x1) + 3.0 * t**2 * (1.0 - x2);
    const diff = bx - p;
    if (Math.abs(diff) < 1e-6) break;
    if (Math.abs(dbx) > 1e-6) {
      t = Math.max(0.0, Math.min(1.0, t - diff / dbx));
    } else {
      break;
    }
  }
  return 3.0 * (1.0 - t)**2 * t * y1 + 3.0 * (1.0 - t) * t**2 * y2 + t**3;
}

function evalEasing(eStr, p) {
  p = Math.max(0.0, Math.min(1.0, p));
  if (!eStr || eStr === 'None') return p;
  if (eStr.startsWith('cubicBezier')) {
    const parts = eStr.split(' ').slice(1).map(Number);
    return evalCubicBezier(parts[0], parts[1], parts[2], parts[3], p);
  }
  if (eStr.includes('elastic')) {
    if (p === 0) return 0.0;
    if (p === 1) return 1.0;
    return Math.sin(-13.0 * (Math.PI / 2.0) * (p + 1.0)) * Math.pow(2.0, -10.0 * p) + 1.0;
  }
  return p;
}

function interpolateKfs(kfs, t) {
  if (!kfs || kfs.length === 0) return 0;
  if (kfs.length === 1) return kfs[0][1];
  if (t <= kfs[0][0]) return kfs[0][1];
  if (t >= kfs[kfs.length - 1][0]) return kfs[kfs.length - 1][1];

  for (let i = 0; i < kfs.length - 1; i++) {
    const [t0, v0, e0] = kfs[i];
    const [t1, v1, e1] = kfs[i + 1];
    if (t0 <= t && t <= t1) {
      if (t1 === t0) return v0;
      const p = (t - t0) / (t1 - t0);
      const u = evalEasing(e1, p);
      if (Array.isArray(v0)) {
        return v0.map((val, idx) => val + u * (v1[idx] - val));
      }
      return v0 + u * (v1 - v0);
    }
  }
  return kfs[kfs.length - 1][1];
}

// =====================================================================
// 16 BEAT BOOKMARK MAPPINGS & MOTION PARAMETERS
// =====================================================================
const BEAT_BOOKMARKS = [
  { start:  9341, end: 10041, id: '2000009688', foto: 1, label: 'Beat 1 (Kick)' },
  { start: 10041, end: 10525, id: '2000009684', foto: 1, label: 'Beat 2 (Ayun Kanan)' },
  { start: 10525, end: 10758, id: '2000009685', foto: 1, label: 'Beat 3 (Punch)' },
  { start: 10758, end: 11241, id: '2000009686', foto: 1, label: 'Beat 4 (Tilt 13°)' },
  { start: 11241, end: 11941, id: '2000009687', foto: 1, label: 'Beat 5 (Mirror Leap)' },
  { start: 11941, end: 12408, id: '2000009694', foto: 1, label: 'Beat 6 (Leap 1)' },
  { start: 12408, end: 12658, id: '2000009695', foto: 1, label: 'Beat 7 (Leap 2)' },
  { start: 12658, end: 13125, id: '2000009696', foto: 1, label: 'Beat 8 (Leap 3)' },
  { start: 13125, end: 13808, id: '2000009689', foto: 2, label: 'Beat 9 (Foto 2 In)' },
  { start: 13808, end: 14308, id: '2000009690', foto: 2, label: 'Beat 10 (Zoom 1.49x)' },
  { start: 14308, end: 14541, id: '2000009691', foto: 2, label: 'Beat 11 (Punch 1.52x)' },
  { start: 14541, end: 15025, id: '2000009692', foto: 2, label: 'Beat 12 (Drop 0.78x)' },
  { start: 15025, end: 15725, id: '2000009693', foto: 2, label: 'Beat 13 (3D Flip 1)' },
  { start: 15725, end: 16208, id: '2000009697', foto: 2, label: 'Beat 14 (3D Flip 2)' },
  { start: 16208, end: 16425, id: '2000009698', foto: 2, label: 'Beat 15 (3D Flip 3)' },
  { start: 16425, end: 16908, id: '2000009699', foto: 2, label: 'Beat 16 (3D Flip 4)' }
];

const SHAPES_DATA = {
  '2000009688': {
    st: 9333, et: 10049,
    scaleKfs: [
      [0.0112, [0.652, 1.0], ''],
      [0.5000, [1.000, 1.0], 'cubicBezier 0.91 0.0 0.58 1.0'],
      [0.9888, [1.151, 1.151], 'cubicBezier 1.0 0.0 1.0 0.35753465']
    ],
    rotKfs: [],
    locKfs: [
      [0.0112, [265.44, 0], ''],
      [0.5000, [0.065, 0], 'cubicBezier 0.905 0.0 0.58 1.0']
    ],
    oscFreq: 4.0, oscMag: [[0.5000, 0, ''], [0.9888, 468, 'cubicBezier 1.0 0.0 1.0 0.0']], oscAng: 0.0,
    swayMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    swayAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009684': {
    st: 10033, et: 10532,
    scaleKfs: [
      [0.0160, [0.8068, 0.8068], 'cubicBezier 1.0 0.0 1.0 0.35753465'],
      [0.5852, [1.1510, 1.1510], 'cubicBezier 0.0 0.67067 0.0 1.0'],
      [0.9860, [0.8609, 0.8609], 'cubicBezier 1.0 0.0 1.0 0.33']
    ],
    rotKfs: [], locKfs: [],
    oscFreq: 4.0, oscMag: [[0.0160, 1637, ''], [0.9860, 0, 'cubicBezier 0.0 1.0 0.0 1.0']], oscAng: 0.0,
    swayMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    swayAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009685': {
    st: 10516, et: 10765,
    scaleKfs: [
      [0.0361, [1.2469, 1.2469], 'cubicBezier 1.0 0.0 1.0 0.33'],
      [0.4378, [1.0063, 1.0063], 'cubicBezier 0.0 0.67 0.0 1.0'],
      [0.9719, [1.2172, 1.2172], 'cubicBezier 1.0 0.0 1.0 0.33']
    ],
    rotKfs: [], locKfs: [],
    oscFreq: 4.0, oscMag: [[0.0160, 1637, ''], [0.9860, 0, 'cubicBezier 0.0 1.0 0.0 1.0']], oscAng: 0.0,
    swayMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    swayAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009686': {
    st: 10750, et: 11249,
    scaleKfs: [
      [0.0160, [0.9214, 0.9214], 'cubicBezier 1.0 0.0 1.0 0.33'],
      [0.4509, [1.2172, 1.2172], 'cubicBezier 0.0 0.67 0.0 1.0']
    ],
    rotKfs: [
      [0.4509, 0.0, ''],
      [0.9840, 13.17, 'cubicBezier 1.0 0.0 1.0 1.0']
    ],
    locKfs: [],
    oscFreq: 4.0, oscMag: [[0.0160, 1637, ''], [0.9860, 0, 'cubicBezier 0.0 1.0 0.0 1.0']], oscAng: 0.0,
    swayMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    swayAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009687': {
    st: 11233, et: 11949,
    scaleKfs: [
      [0.0112, [-1.2172, 1.2172], ''],
      [0.4302, [-1.0000, 1.0000], 'cubicBezier 0.0 0.67 0.0 1.0']
    ],
    rotKfs: [
      [0.0112, -16.46, ''],
      [0.4078, 0.0, 'cubicBezier 0.0 0.67 0.0 1.0']
    ],
    locKfs: [
      [0.5475, [0.065, 0], ''],
      [0.9888, [0.065, 74.82], 'cubicBezier 1.0 0.0 1.0 1.0']
    ],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009694': {
    st: 11933, et: 12415,
    scaleKfs: [
      [0.0166, [-1.138, 1.138], ''],
      [0.5021, [-1.1922, 1.1922], 'cubicBezier 0.42 0.0 0.58 1.0']
    ],
    rotKfs: [],
    locKfs: [
      [0.0166, [0.065, 74.82], 'cubicBezier 1.0 0.0 1.0 1.0'],
      [0.5021, [0.065, 0.00], 'cubicBezier 0.0 0.0 0.0 1.0'],
      [0.9855, [0.065, 74.82], 'cubicBezier 1.0 0.0 1.0 1.0']
    ],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009695': {
    st: 12400, et: 12665,
    scaleKfs: [
      [0.0302, [-1.040, 1.040], ''],
      [0.4717, [-0.9932, 0.9932], 'cubicBezier 0.42 0.0 0.58 1.0']
    ],
    rotKfs: [],
    locKfs: [
      [0.0302, [0.065, 74.82], 'cubicBezier 1.0 0.0 1.0 1.0'],
      [0.4717, [0.065, 0.00], 'cubicBezier 0.0 0.0 0.0 1.0'],
      [0.9736, [0.065, 74.82], 'cubicBezier 0.965 0.0 1.0 1.0']
    ],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009696': {
    st: 12650, et: 13132,
    scaleKfs: [
      [0.0166, [-1.041, 1.041], ''],
      [0.9855, [-0.8708, 0.8708], 'cubicBezier 1.0 -2.0 1.0 1.0']
    ],
    rotKfs: [],
    locKfs: [
      [0.0166, [0.065, 74.82], 'cubicBezier 0.965 0.0 1.0 1.0'],
      [0.5000, [0.065, 0.00], 'cubicBezier 0.0 0.0 0.0 1.0']
    ],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009689': {
    st: 13116, et: 13815,
    scaleKfs: [
      [0.0129, [1.2208, 1.2208], ''],
      [0.5608, [1.0000, 1.0000], 'cubicBezier 0.0 0.0 0.0 1.0'],
      [0.9900, [0.8010, 0.8010], 'cubicBezier 1.0 0.0 1.0 0.323']
    ],
    rotKfs: [], locKfs: [],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009690': {
    st: 13800, et: 14315,
    scaleKfs: [
      [0.0155, [-1.4938, 1.4938], 'cubicBezier 1.0 0.0 1.0 0.323'],
      [0.5010, [-1.0000, 1.0000], 'cubicBezier 0.0 0.68 0.0 1.0'],
      [0.9864, [-0.8208, 0.8208], 'cubicBezier 1.0 0.0 1.0 0.32']
    ],
    rotKfs: [], locKfs: [],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009691': {
    st: 14300, et: 14549,
    scaleKfs: [
      [0.0321, [1.5229, 1.5229], 'cubicBezier 1.0 0.0 1.0 0.32'],
      [0.5020, [1.0000, 1.0000], 'cubicBezier 0.0 0.68 0.0 1.0'],
      [0.9679, [1.2766, 1.2766], 'cubicBezier 1.0 0.0 1.0 0.32']
    ],
    rotKfs: [], locKfs: [],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009692': {
    st: 14533, et: 15032,
    scaleKfs: [
      [0.0160, [0.7781, 0.7781], 'cubicBezier 1.0 0.0 1.0 0.32'],
      [0.4850, [1.1734, 1.1734], 'cubicBezier 0.0 0.68 0.0 1.0'],
      [0.9860, [0.8854, 0.8854], 'cubicBezier 1.0 0.0 1.0 0.32']
    ],
    rotKfs: [], locKfs: [],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009693': {
    st: 15016, et: 15732,
    scaleKfs: [
      [0.0126, [-1.4104, 1.4104], 'cubicBezier 1.0 0.0 1.0 0.32'],
      [0.4539, [-1.0083, 1.0083], 'cubicBezier 0.0 0.68 0.0 1.0'],
      [0.9900, [-1.0083, 1.0083], '']
    ],
    rotKfs: [], locKfs: [],
    flipKfs: [
      [1.3617, 0.0, ''],
      [1.8045, 180.0, 'cubicBezier 0.86 0.0 0.58 1.0'],
      [2.2933, 0.0, 'cubicBezier 0.42 0.0 0.14 1.0']
    ],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009697': {
    st: 15716, et: 16215,
    scaleKfs: [
      [0.0126, [-1.0083, 1.0083], ''],
      [0.5511, [-1.0083, 1.0083], ''],
      [1.1864, [-0.8703, 0.8703], 'cubicBezier 0.86 0.0 0.58 1.0']
    ],
    rotKfs: [], locKfs: [],
    flipKfs: [
      [0.5511, 0.0, ''],
      [1.1864, 180.0, 'cubicBezier 0.86 0.0 0.58 1.0'],
      [1.8878, 0.0, 'cubicBezier 0.42 0.0 0.14 1.0']
    ],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009698': {
    st: 16200, et: 16432,
    scaleKfs: [
      [0.0126, [-0.932, 0.932], ''],
      [0.4655, [-0.8703, 0.8703], 'cubicBezier 0.86 0.0 0.58 1.0']
    ],
    rotKfs: [], locKfs: [],
    flipKfs: [
      [-0.9009, 0.0, ''],
      [0.4655, 180.0, 'cubicBezier 0.86 0.0 0.58 1.0'],
      [1.9741, 0.0, 'cubicBezier 0.42 0.0 0.14 1.0']
    ],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  },
  '2000009699': {
    st: 16416, et: 16915,
    scaleKfs: [
      [0.0126, [-1.042, 1.042], ''],
      [0.4850, [-1.2146, 1.2146], 'cubicBezier 0.42 0.0 0.14 1.0']
    ],
    rotKfs: [], locKfs: [],
    flipKfs: [
      [-0.8517, 0.0, ''],
      [-0.2164, 180.0, 'cubicBezier 0.86 0.0 0.58 1.0'],
      [0.4850, 0.0, 'cubicBezier 0.42 0.0 0.14 1.0']
    ],
    opacityKfs: [
      [0.4850, 1.0, ''],
      [0.9860, 0.0, '']
    ],
    oscFreq: 0.86, oscMag: [[0.0112, 70, ''], [0.9888, 0, 'cubicBezier 0.0 0.0 0.58 1.0']],
    oscAng: [[0.0112, 90, ''], [0.9888, -90, 'cubicBezier 0.0 0.0 0.58 1.0']]
  }
};

// =====================================================================
// PRESET 2: "kannxue | pelukan yang hangat" -- CONTINUOUS TRACKS & BEATS
// 100% Studio Reconstructor Engine (60 FPS)
// =====================================================================
const BEAT_MAP2 = [
  { start: 8258, end: 8708, foto: 1, label: 'Beat 1 (Kick F1)' },
  { start: 8708, end: 8925, foto: 1, label: 'Beat 2 (Bounce)' },
  { start: 8925, end: 9358, foto: 1, label: 'Beat 3 (Whip)' },
  { start: 9358, end: 9591, foto: 1, label: 'Beat 4 (Kick)' },
  { start: 9591, end: 10041, foto: 1, label: 'Beat 5 (3D Flip In)' },
  { start: 10041, end: 10491, foto: 1, label: 'Beat 6 (3D Flip Out)' },
  { start: 10491, end: 10708, foto: 1, label: 'Beat 7 (Punch)' },
  { start: 10708, end: 11158, foto: 1, label: 'Beat 8 (Zoom 1.4x)' },
  { start: 11158, end: 11391, foto: 1, label: 'Beat 9 (Drop Y)' },
  { start: 11391, end: 11841, foto: 1, label: 'Beat 10 (Slide F1/F2)' },
  { start: 11841, end: 12291, foto: 2, label: 'Beat 11 (Foto 2 Kick)' },
  { start: 12291, end: 12525, foto: 2, label: 'Beat 12 (3D Tilt)' },
  { start: 12525, end: 12958, foto: 2, label: 'Beat 13 (Drop Y+355)' },
  { start: 12958, end: 13175, foto: 2, label: 'Beat 14 (Punch)' },
  { start: 13175, end: 13641, foto: 2, label: 'Beat 15 (Zoom 1.26x)' },
  { start: 13641, end: 14075, foto: 2, label: 'Beat 16 (Rot +5.5°)' },
  { start: 14075, end: 14308, foto: 2, label: 'Beat 17 (Kick)' },
  { start: 14308, end: 14758, foto: 2, label: 'Beat 18 (Drop Y+430)' },
  { start: 14758, end: 15041, foto: 2, label: 'Beat 19 (Rot -5.5°)' },
  { start: 15041, end: 15425, foto: 2, label: 'Beat 20 (White Fade)' }
];

const TRACK_F1_SCALE = [
  [7808, [0.0, 0.000521], ''],
  [8258, [1.0, 1.0], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [8491, [1.0, 1.0], ''],
  [8825, [0.692592, 1.0], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [9125, [0.674074, 0.617509], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [9475, [1.047222, 0.779052], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [9825, [0.809258, 0.63679], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [10275, [0.809258, 0.63679], ''],
  [10608, [0.809258, 0.972382], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [10941, [1.406481, 0.972382], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [11275, [0.751851, 0.569568], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [11608, [1.051852, 0.830641], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [11841, [0.0, 0.830641], 'cubicBezier 0.72412586 0.0 1.0 1.0']
];

const TRACK_F1_LOC = [
  [7800, [0.0, 0.0], ''],
  [10941, [0.0, 0.0], 'cubicBezier 0.78 0.0 1.0 1.0'],
  [11158, [0.0, 560.735], 'cubicBezier 0.78 0.0 1.0 1.0'],
  [11275, [0.0, 0.0], 'cubicBezier 0.0 0.0 0.22000003 1.0'],
  [11391, [0.0, 560.735], 'cubicBezier 0.78 0.0 1.0 1.0'],
  [11608, [0.0, 0.0], 'cubicBezier 0.0 0.0 0.22000003 1.0'],
  [11841, [-538.969, 0.0], 'cubicBezier 0.72 0.0 1.0 1.0']
];

const TRACK_F1_FLIP = [
  [9591, 0.0, ''],
  [10491, -180.0, 'cubicBezier 1.0 -0.3855715 0.0 1.4972832']
];

const TRACK_NOL3_SCALE = [
  [8475, [1.0, 1.0], ''],
  [8808, [1.32, 1.32], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [9158, [1.04, 1.04], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [9475, [1.22, 1.22], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [9841, [1.90, 1.90], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [10275, [1.22, 1.22], 'cubicBezier 0.7065047 0.0 0.4187047 1.0'],
  [11608, [1.0, 1.0], 'cubicBezier 0.42 0.0 0.58 1.0']
];

const TRACK_NOL3_LOC = [
  [10275, [0.0, 0.0], ''],
  [10958, [104.618, -44.435], 'reverse elastic 0.34314048 1.0 0.08167088 0.42712796'],
  [11849, [38.438, 0.0], 'elastic 0.34314048 1.0 0.08167088 0.42712796']
];

const TRACK_F2_SCALE = [
  [11600, [0.0, 0.8322], ''],
  [11841, [1.0, 0.8322], 'cubicBezier 0.72 0.0 1.0 1.0'],
  [13633, [1.0, 0.8322], ''],
  [13858, [1.0, 0.8322], ''],
  [14191, [1.24, 0.8322], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [14541, [1.24, 0.8999], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [14891, [1.0, 0.8999], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [15225, [1.0, 0.8322], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [15425, [1.36, 1.095], 'cubicBezier 0.72 0.0 1.0 1.0']
];

const TRACK_F2_LOC = [
  [11600, [543.34, 0.0], ''],
  [11841, [0.0, 0.0], 'cubicBezier 0.72 0.0 1.0 1.0'],
  [13175, [0.0, 0.0], ''],
  [13641, [951.439, 0.0], 'cubicBezier 1.0 -0.4063063 1.0 1.0'],
  [13642, [-945.056, 0.0], ''],
  [14075, [0.0, 0.0], 'cubicBezier 0.0 0.0 0.0 1.0']
];

const TRACK_F2_FLIP = [];

const TRACK_NOL1_SCALE = [
  [12041, [1.0, 1.0], ''],
  [12408, [1.34, 1.34], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [12758, [0.98, 0.98], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [13075, [1.26, 1.26], 'cubicBezier 0.42 0.0 0.58 1.0']
];

const TRACK_NOL1_LOC = [
  [12758, [0.0, 0.0], ''],
  [12958, [0.0, 355.177], 'cubicBezier 1.0 0.0 1.0 1.0'],
  [13075, [0.0, 0.0], 'cubicBezier 0.0 0.0 0.0 1.0'],
  [13175, [0.0, 355.177], 'cubicBezier 1.0 0.0 1.0 1.0'],
  [13408, [0.0, 0.0], 'cubicBezier 0.0 0.0 0.0 1.0']
];

const TRACK_NOL2_SCALE = [
  [13858, [1.0, 1.0], ''],
  [14175, [1.28, 1.28], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [14525, [0.88, 0.88], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [14908, [1.16, 1.16], 'cubicBezier 0.42 0.0 0.58 1.0'],
  [15241, [0.80, 0.80], 'cubicBezier 0.42 0.0 0.58 1.0']
];

const TRACK_NOL2_LOC = [
  [14525, [0.0, 0.0], 'cubicBezier 1.0 0.0 1.0 1.0'],
  [14758, [0.0, 430.174], 'cubicBezier 1.0 0.0 1.0 1.0'],
  [14908, [0.0, 0.0], 'cubicBezier 0.0 0.0 0.0 1.0'],
  [15041, [0.0, 430.174], 'cubicBezier 1.0 0.0 1.0 1.0'],
  [15241, [0.0, 0.0], 'cubicBezier 0.0 0.0 0.0 1.0']
];

const TRACK_NOL2_ROT = [
  [13633, 0.0, 'cubicBezier 0.42 0.0 0.58 1.0'],
  [13700, 1.8, 'cubicBezier 0.42 0.0 0.58 1.0'],
  [13760, 0.0, 'cubicBezier 0.42 0.0 0.58 1.0'],
  [13900, -2.5, 'cubicBezier 0.42 0.0 0.58 1.0'],
  [14000, 0.0, 'cubicBezier 0.42 0.0 0.58 1.0'],
  [14175, 5.5, 'cubicBezier 0.25 0.1 0.25 1.0'],
  [14300, 2.0, 'cubicBezier 0.42 0.0 0.58 1.0'],
  [14500, -8.5, 'cubicBezier 0.25 0.1 0.25 1.0'],
  [14680, -1.5, 'cubicBezier 0.42 0.0 0.58 1.0'],
  [14750, 0.0, 'cubicBezier 0.42 0.0 0.58 1.0'],
  [14880, -3.2, 'cubicBezier 0.42 0.0 0.58 1.0'],
  [14980, 0.0, 'cubicBezier 0.42 0.0 0.58 1.0'],
  [15425, 0.0, 'cubicBezier 0.42 0.0 0.58 1.0']
];

const emojiStickerImg = new Image();
emojiStickerImg.src = '/assets/emoji_p2.png';

function interpAbs(kfs, t, defaultVal) {
  if (!kfs || kfs.length === 0) return defaultVal;
  if (t <= kfs[0][0]) return kfs[0][1];
  if (t >= kfs[kfs.length - 1][0]) return kfs[kfs.length - 1][1];
  for (let i = 0; i < kfs.length - 1; i++) {
    const [t0, v0, e0] = kfs[i];
    const [t1, v1, e1] = kfs[i + 1];
    if (t0 <= t && t <= t1) {
      if (t1 === t0) return v0;
      const p = (t - t0) / (t1 - t0);
      const u = evalEasing(e1, p);
      if (Array.isArray(v0)) {
        return v0.map((val, idx) => val + u * (v1[idx] - val));
      }
      return v0 + u * (v1 - v0);
    }
  }
  return kfs[kfs.length - 1][1];
}

const S_COORD = W / 1080.0;

function evalTransformAt2(ms) {
  if (ms < 7800) return null;

  let activeB = null;
  for (const b of BEAT_MAP2) {
    if (b.start <= ms && ms < b.end) {
      activeB = b;
      break;
    }
  }
  if (!activeB) {
    if (ms < 8258) {
      activeB = { start: 7800, end: 8258, foto: 1, label: 'Intro Buildup' };
    } else {
      activeB = BEAT_MAP2[BEAT_MAP2.length - 1];
    }
  }

  const bSt = activeB.start;
  const bEt = activeB.end;
  const bDur = bEt - bSt;
  const tSec = Math.max(0.0, (ms - bSt) / 1000.0);

  // Child beat oscillate (freq=0.86 Hz, mag=62 -> 0, angle=90 -> -90)
  const pOsc = bDur > 0 ? Math.min(1.0, Math.max(0.0, (ms - bSt) / (0.93985 * bDur))) : 1.0;
  const magC = 62.0 * (1.0 - pOsc);
  const angC = 90.0 - 180.0 * pOsc;
  const dispC = magC * Math.sin(2.0 * Math.PI * 0.86 * tSec) * S_COORD;
  const radC = (angC * Math.PI) / 180.0;
  const oscCx = dispC * Math.cos(radC);
  const oscCy = dispC * Math.sin(radC);

  if (ms < 11841) {
    // FOTO 1 TRACKS
    const scC = interpAbs(TRACK_F1_SCALE, ms, [1.0, 1.0]);
    const locC = interpAbs(TRACK_F1_LOC, ms, [0.0, 0.0]);
    const flipC = interpAbs(TRACK_F1_FLIP, ms, 0.0);

    let scP = [1.0, 1.0];
    let locP = [0.0, 0.0];
    let oscPx = 0.0, oscPy = 0.0;

    // Parent: Nol 3 (8250 - 11849)
    if (ms >= 8250 && ms <= 11849) {
      scP = interpAbs(TRACK_NOL3_SCALE, ms, [1.0, 1.0]);
      locP = interpAbs(TRACK_NOL3_LOC, ms, [0.0, 0.0]);
      const tSecP = (ms - 8250.0) / 1000.0;
      const dispP = 47.0 * Math.sin(2.0 * Math.PI * 1.25 * tSecP) * S_COORD;
      const angP = 45.0 + 45.0 * Math.min(1.0, (ms - 8250.0) / 3599.0);
      const radP = (angP * Math.PI) / 180.0;
      oscPx = dispP * Math.cos(radP);
      oscPy = dispP * Math.sin(radP);
    }

    const sx = scC[0] * scP[0];
    const sy = scC[1] * scP[1];
    const dx = (locC[0] * S_COORD) + oscCx + (locP[0] * S_COORD) + oscPx;
    const dy = (locC[1] * S_COORD) + oscCy + (locP[1] * S_COORD) + oscPy;
    return { foto: 1, sx, sy, dx, dy, rot: 0.0, flip: flipC, label: activeB.label };
  } else {
    // FOTO 2 TRACKS
    const scC = interpAbs(TRACK_F2_SCALE, ms, [1.0, 0.832]);
    const locC = interpAbs(TRACK_F2_LOC, ms, [0.0, 0.0]);
    const flipC = interpAbs(TRACK_F2_FLIP, ms, 0.0);

    let scP = [1.0, 1.0];
    let locP = [0.0, 0.0];
    let rotP = 0.0;
    let oscPx = 0.0, oscPy = 0.0;

    if (ms < 13641) {
      // Parent: Nol 1 (11833 - 13649)
      scP = interpAbs(TRACK_NOL1_SCALE, ms, [1.0, 1.0]);
      locP = interpAbs(TRACK_NOL1_LOC, ms, [0.0, 0.0]);
      const tSecP = (ms - 11833.0) / 1000.0;
      const dispP = 47.0 * Math.sin(2.0 * Math.PI * 1.25 * tSecP) * S_COORD;
      const angP = 45.0 + 45.0 * Math.min(1.0, (ms - 11833.0) / 1816.0);
      const radP = (angP * Math.PI) / 180.0;
      oscPx = dispP * Math.cos(radP);
      oscPy = dispP * Math.sin(radP);
    } else {
      // Parent: Nol 2 (13633 - 15432)
      scP = interpAbs(TRACK_NOL2_SCALE, ms, [1.0, 1.0]);
      locP = interpAbs(TRACK_NOL2_LOC, ms, [0.0, 0.0]);
      rotP = interpAbs(TRACK_NOL2_ROT, ms, 0.0);
      const tSecP = (ms - 13633.0) / 1000.0;
      const dispP = 47.0 * Math.sin(2.0 * Math.PI * 1.25 * tSecP) * S_COORD;
      const angP = 45.0 + 45.0 * Math.min(1.0, (ms - 13633.0) / 1799.0);
      const radP = (angP * Math.PI) / 180.0;
      oscPx = dispP * Math.cos(radP);
      oscPy = dispP * Math.sin(radP);
    }

    const sx = scC[0] * scP[0];
    const sy = scC[1] * scP[1];
    const dx = (locC[0] * S_COORD) + oscCx + (locP[0] * S_COORD) + oscPx;
    const dy = (locC[1] * S_COORD) + oscCy + (locP[1] * S_COORD) + oscPy;
    return { foto: 2, sx, sy, dx, dy, rot: rotP, flip: flipC, label: activeB.label };
  }
}

// =====================================================================
// PRE-RENDER 2-LAYAR WITH CUSTOM PAN & ZOOM FRAMING
// =====================================================================
function update2LayarCanvas(targetCtx, img, transform) {
  if (!img || !img.complete || img.naturalWidth === 0) return;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  const tX = transform ? (transform.x || 0) : 0;
  const tY = transform ? (transform.y || 0) : 0;
  const zoom = transform ? Math.max(1.0, transform.zoom || 1.0) : 1.0;

  const baseScale = Math.max(W / iw, H2 / ih);
  const scale = baseScale * zoom;
  const nw = iw * scale;
  const nh = ih * scale;

  // Center coordinate + custom translation offset
  const drawX = (W - nw) / 2 + tX;
  const drawY = (H2 - nh) / 2 + tY;

  targetCtx.clearRect(0, 0, W, H);

  // Upper half (clipped to 0, 0, W, H2)
  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(0, 0, W, H2);
  targetCtx.clip();
  targetCtx.fillStyle = '#050505';
  targetCtx.fillRect(0, 0, W, H2);
  targetCtx.drawImage(img, drawX, drawY, nw, nh);
  targetCtx.restore();

  // Lower half (clipped to 0, H2, W, H2)
  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(0, H2, W, H2);
  targetCtx.clip();
  targetCtx.fillStyle = '#050505';
  targetCtx.fillRect(0, H2, W, H2);
  targetCtx.drawImage(img, drawX, H2 + drawY, nw, nh);
  targetCtx.restore();

  // Clean Dividing Seam Line
  targetCtx.fillStyle = '#0a0a0a';
  targetCtx.fillRect(0, H2 - 1, W, 2);
  targetCtx.fillStyle = '#e6e6e6';
  targetCtx.fillRect(0, H2 + 1, W, 1);
}

// =====================================================================
// MAIN FRAME RENDER ENGINE (CALLED EVERY FRAME)
// =====================================================================
let lastSegmentLabel = null;
function setSegmentLabel(text) {
  // Avoid a DOM write on every one of the 60 frames/sec when the label
  // hasn't actually changed (segments last hundreds of ms each).
  if (text !== lastSegmentLabel) {
    lastSegmentLabel = text;
    currentSegmentTag.textContent = text;
  }
}

function renderFrame(ms) {
  if (currentPreset === 3) {
    renderFrame3(ms);
    return;
  }
  if (currentPreset === 2) {
    renderFrame2(ms);
    return;
  }
  renderFrame1(ms);
}

function renderFrame1(ms) {
  // Clear canvas to clean white (#ffffff)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // -------------------------------------------------------------------
  // SEGMEN 1: Intro Kinetic Typography (0 - 4533 ms)
  // -------------------------------------------------------------------
  if (ms < 4533) {
    setSegmentLabel('Intro: Kinetic Text');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    let yDip = 0;
    if (ms >= 3733) {
      const pDip = (ms - 3733) / (4533 - 3733);
      yDip = 55.0 * evalCubicBezier(0.5, 1.0, 0.0, 1.0, pDip);
    }

    ctx.fillStyle = '#0f0f0f';
    ctx.font = 'bold 54px Roboto, Arial, sans-serif';

    if (ms < 617) {
      const tw = ctx.measureText('jangan').width;
      ctx.fillText('jangan', (W - tw) / 2, H / 2 - 20);
    } else {
      ctx.fillText('jangan', 210, 490 + yDip);
    }

    if (ms >= 617) {
      ctx.fillText('harap', 210, 590 + yDip);
    }

    if (ms >= 2500) {
      ctx.fillText('ku', 450, 590 + yDip);
      ctx.fillText('kan', 210, 690 + yDip);
      ctx.fillText('kembali', 410, 690 + yDip);
    } else if (ms >= 1984) {
      ctx.fillText('ku', 210, 690 + yDip);
      ctx.fillText('kan', 450, 690 + yDip);
    } else if (ms >= 1650) {
      ctx.fillText('ku', 210, 690 + yDip);
    }
  }
  // -------------------------------------------------------------------
  // SEGMEN 2: Pre-Drop Glitch (4533 - 4641 ms)
  // -------------------------------------------------------------------
  else if (ms < 4641) {
    setSegmentLabel('Pre-Drop Glitch');
    ctx.drawImage(canvas2Layar1, 0, 0);
    if (ms < 4584) {
      ctx.fillStyle = 'rgba(195, 65, 50, 0.45)';
      ctx.fillRect(0, 0, W, H);
    } else {
      const pFl = (4641 - ms) / (4641 - 4584);
      ctx.fillStyle = `rgba(255, 255, 255, ${pFl * 0.75})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
  // -------------------------------------------------------------------
  // SEGMEN 3: Foto 1 (2 Layar) + "padamu" Reveal (4641 - 6750 ms)
  // -------------------------------------------------------------------
  else if (ms < 6750) {
    setSegmentLabel('Foto 1 • "padamu" Reveal');
    const dt = (ms - 4641) / 1000.0;
    const swayDeg = 3.3 * Math.sin(2.0 * Math.PI * 1.8 * dt);
    const dySway = 20.0 * Math.sin(2.0 * Math.PI * 1.8 * dt);
    const scaleSway = 1.08 + 0.04 * Math.cos(2.0 * Math.PI * 0.9 * dt);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((swayDeg * Math.PI) / 180.0);
    ctx.scale(scaleSway, scaleSway);
    ctx.translate(-W / 2, -H / 2 + dySway);
    ctx.drawImage(canvas2Layar1, 0, 0);
    ctx.restore();

    if (ms < 4900) {
      const pFl = (4900 - ms) / 260.0;
      ctx.fillStyle = `rgba(255, 255, 255, ${pFl * 0.65})`;
      ctx.fillRect(0, 0, W, H);
    }

    const fullWord = 'padamu';
    const pRev = Math.min(1.0, (ms - 4641) / 1600.0);
    const numC = Math.max(1, Math.floor(pRev * fullWord.length + 0.9));
    const currWord = fullWord.slice(0, numC);

    ctx.font = 'bold 44px Roboto, Arial, sans-serif';
    const tw = ctx.measureText(currWord).width;
    const tx = (W - tw) / 2;
    const ty = H2 + 15;

    ctx.fillStyle = '#000000';
    for (let ox of [-2, 0, 2]) {
      for (let oy of [-2, 0, 2]) {
        ctx.fillText(currWord, tx + ox, ty + oy);
      }
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillText(currWord, tx, ty);
  }
  // -------------------------------------------------------------------
  // SEGMEN 4: Smooth 2-Column Slide Transition (6750 - 9341 ms)
  // -------------------------------------------------------------------
  else if (ms < 9341) {
    setSegmentLabel('Slide Transition');
    const dt = (ms - 6750) / 1000.0;
    const swayDeg = 2.5 * Math.sin(2.0 * Math.PI * 1.5 * dt);
    const dySway = 15.0 * Math.sin(2.0 * Math.PI * 1.5 * dt);

    if (ms < 8841) {
      const pSlide = Math.min(1.0, (ms - 6750) / 1525.0);
      const uSlide = evalCubicBezier(0.87, 0.0, 0.21, 1.0, pSlide);
      const wCol1 = Math.floor(W - (W / 2) * uSlide);
      const wCol2 = W - wCol1;

      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate((swayDeg * Math.PI) / 180.0);
      ctx.scale(1.06, 1.06);
      ctx.translate(-W / 2, -H / 2 + dySway);

      ctx.drawImage(canvas2Layar1, 0, 0, W, H, 0, 0, wCol1, H);
      if (wCol2 > 0) {
        ctx.drawImage(canvas2Layar1, 0, 0, W, H, wCol1, 0, wCol2, H);
      }

      ctx.fillStyle = '#141414';
      ctx.fillRect(wCol1 - 1, 0, 2, H);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(wCol1 + 1, 0, 1, H);
      ctx.restore();

      if (ms < 7441) {
        const pFade = (7441 - ms) / 691.0;
        ctx.font = 'bold 44px Roboto, Arial, sans-serif';
        const tw = ctx.measureText('padamu').width;
        const tx = (W - tw) / 2;
        const ty = H2 + 15;
        ctx.fillStyle = `rgba(255, 255, 255, ${pFade})`;
        ctx.fillText('padamu', tx, ty);
      }
    } else {
      const pExpand = (ms - 8841) / (9341 - 8841);
      const uExpand = evalCubicBezier(0.91, 0.0, 0.58, 1.0, pExpand);
      const wCol1 = Math.floor((W / 2) * (1.0 - uExpand));
      const wCol2 = W - wCol1;

      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate((swayDeg * Math.PI) / 180.0);
      ctx.scale(1.06, 1.06);
      ctx.translate(-W / 2, -H / 2 + dySway);

      if (wCol1 > 0) {
        ctx.drawImage(canvas2Layar1, 0, 0, W, H, 0, 0, wCol1, H);
      }
      ctx.drawImage(canvas2Layar1, 0, 0, W, H, wCol1, 0, wCol2, H);
      ctx.restore();
    }
  }
  // -------------------------------------------------------------------
  // SEGMEN 5: 16 BEAT MOTION JEDAG-JEDUG (9341 - 16908 ms)
  // -------------------------------------------------------------------
  else if (ms < 16908) {
    let activeBeat = BEAT_BOOKMARKS[0];
    for (let b of BEAT_BOOKMARKS) {
      if (b.start <= ms && ms < b.end) {
        activeBeat = b;
        break;
      }
    }
    setSegmentLabel(activeBeat.label);

    const shape = SHAPES_DATA[activeBeat.id];
    const dur = shape.et - shape.st;
    const relT = (ms - shape.st) / dur;
    const tSec = Math.max(0.0, (ms - activeBeat.start) / 1000.0);

    let [sx, sy] = interpolateKfs(shape.scaleKfs, relT) || [1.0, 1.0];
    const rot = interpolateKfs(shape.rotKfs, relT) || 0.0;
    const loc = interpolateKfs(shape.locKfs, relT) || [0.0, 0.0];
    const lx = (loc[0] || 0) * (W / 1080.0);
    const ly = (loc[1] || 0) * (W / 1080.0);

    let oscDx = 0.0;
    let oscDy = 0.0;
    const sCoord = W / 1080.0;

    if (shape.oscFreq) {
      const mag = interpolateKfs(shape.oscMag, relT);
      const ang = Array.isArray(shape.oscAng) ? interpolateKfs(shape.oscAng, relT) : shape.oscAng;
      const theta = 2.0 * Math.PI * shape.oscFreq * tSec;
      const disp = mag * Math.sin(theta) * sCoord;
      const rad = (ang * Math.PI) / 180.0;
      oscDx += disp * Math.cos(rad);
      oscDy += disp * Math.sin(rad);
    }

    if (shape.swayMag) {
      const sMag = interpolateKfs(shape.swayMag, relT);
      const sAng = interpolateKfs(shape.swayAng, relT);
      const sTheta = 2.0 * Math.PI * 0.86 * tSec;
      const sDisp = sMag * Math.sin(sTheta) * sCoord;
      const sRad = (sAng * Math.PI) / 180.0;
      oscDx += sDisp * Math.cos(sRad);
      oscDy += sDisp * Math.sin(sRad);
    }

    let flipAngle = 0.0;
    if (shape.flipKfs) {
      flipAngle = interpolateKfs(shape.flipKfs, relT);
    }

    let opacity = 1.0;
    if (shape.opacityKfs) {
      opacity = interpolateKfs(shape.opacityKfs, relT);
    }

    let sourceCanvas = canvas2Layar1;
    if (activeBeat.foto === 2) {
      if (ms >= 15725 && photo3Loaded) {
        sourceCanvas = canvas2Layar3;
      } else {
        sourceCanvas = canvas2Layar2;
      }
    }

    const totalDx = lx + oscDx;
    const totalDy = ly + oscDy;

    ctx.save();
    if (opacity < 1.0) {
      ctx.globalAlpha = Math.max(0.0, opacity);
    }

    const cx = W / 2;
    const cy = H / 2;

    ctx.translate(cx + totalDx, cy + totalDy);
    ctx.rotate((rot * Math.PI) / 180.0);

    const isMirror = sx < 0;
    const absSx = Math.abs(sx);

    let scaleX3D = 1.0;
    if (Math.abs(flipAngle) > 1.0) {
      const radF = (flipAngle * Math.PI) / 180.0;
      const cosF = Math.cos(radF);
      scaleX3D = Math.max(0.01, Math.abs(cosF));
    }

    ctx.scale((isMirror ? -1 : 1) * absSx * scaleX3D, sy);
    ctx.drawImage(sourceCanvas, -cx, -cy);
    ctx.restore();
  }
  // -------------------------------------------------------------------
  // SEGMEN 6: Outro (16908 - 18915 ms)
  // -------------------------------------------------------------------
  else {
    setSegmentLabel('Outro');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
  }
}

// =====================================================================
// PRESET 2 RENDER ENGINE
// The video-insert reveal segment from the original edit (1533-8265ms)
// is rendered with a simple kinetic-text intro, matching the studio aesthetic.
// Everything else (the 20-beat "2 layar" sequence and outro)
// is driven directly by continuous timeline tracks.
// =====================================================================
const INTRO2_PHRASES = [
  { start: 1533, end: 3465, text: 'haaaaaaa...' },
  { start: 3465, end: 5383, text: 'pelukan yang hangat' },
  { start: 5383, end: 7050, text: 'menjadi bayangan' },
  { start: 7050, end: 7800, text: 'so asu' },
];

function drawCardTransform(sourceCanvas, sx, sy, rot, dx, dy, flip) {
  ctx.save();
  const cx = W / 2;
  const cy = H / 2;
  ctx.translate(cx + dx, cy + dy);
  if (rot && Math.abs(rot) > 0.001) {
    ctx.rotate((rot * Math.PI) / 180.0);
  }
  let isMirror = sx < 0;
  const absSx = Math.abs(sx);
  let scaleX3D = 1.0;
  if (flip && Math.abs(flip) > 0.05) {
    const radF = (flip * Math.PI) / 180.0;
    const cosF = Math.cos(radF);
    scaleX3D = Math.max(0.01, Math.abs(cosF));
    if (cosF < 0) {
      isMirror = !isMirror; // Sisi membalik saat melewati 90 deg (3D perspective flip)
    }
  }
  ctx.scale((isMirror ? -1 : 1) * absSx * scaleX3D, sy);
  ctx.drawImage(sourceCanvas, -cx, -cy);
  ctx.restore();
}

function renderPreset2Intro(ms) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // 1. Center crying emoji sticker (4000ms - 7800ms)
  if (ms >= 4000 && ms < 7800 && emojiStickerImg.complete && emojiStickerImg.naturalWidth > 0) {
    const pStk = Math.min(1.0, (ms - 4000) / 300.0);
    const uStk = evalEasing('cubicBezier 0.42 0.0 0.58 1.0', pStk);
    const stkScale = 0.55 * uStk;
    const sw = emojiStickerImg.naturalWidth * stkScale;
    const sh = emojiStickerImg.naturalHeight * stkScale;
    ctx.drawImage(emojiStickerImg, (W - sw) / 2, (H - sh) / 2, sw, sh);
  }

  // 2. Text phrases
  const phrase = INTRO2_PHRASES.find(p => ms >= p.start && ms < p.end);
  if (!phrase) return;

  const localT = ms - phrase.start;
  const dur = phrase.end - phrase.start;
  const popInDur = 160.0;
  const fadeOutDur = 140.0;
  let scale = 1.0;
  let alpha = 1.0;

  if (localT < popInDur) {
    const p = localT / popInDur;
    const u = 1.0 - Math.pow(1.0 - p, 3);
    scale = 0.85 + 0.15 * u;
    alpha = u;
  } else if (localT > dur - fadeOutDur) {
    alpha = Math.max(0.0, (dur - localT) / fadeOutDur);
  }

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(scale, scale);
  ctx.font = 'bold 50px Roboto, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Soft shadow
  ctx.fillStyle = `rgba(180, 180, 180, ${alpha * 0.7})`;
  for (const ox of [-2, 0, 2]) {
    for (const oy of [-2, 0, 2]) {
      if (ox !== 0 || oy !== 0) ctx.fillText(phrase.text, ox, oy);
    }
  }
  // Main text
  ctx.fillStyle = `rgba(15, 15, 15, ${alpha})`;
  ctx.fillText(phrase.text, 0, 0);
  ctx.restore();
}

function renderFrame2(ms) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // SEGMEN 1: Intro Kinetic Typography & Sticker (0 - 7800 ms)
  if (ms < 7800) {
    setSegmentLabel(ms < 1533 ? 'Intro' : 'Intro: Kinetic Text');
    renderPreset2Intro(ms);
    return;
  }

  // SEGMEN 2: Buildup Zoom-In Card (7800 - 8258 ms)
  if (ms < 8258) {
    const tr = evalTransformAt2(ms);
    if (tr) {
      setSegmentLabel('Intro Buildup (Zoom-In)');
      drawCardTransform(canvas2Layar1, tr.sx, tr.sy, tr.rot, tr.dx, tr.dy, tr.flip);
    }
    return;
  }

  // SEGMEN 3: Transition Overlap Between Foto 1 and Foto 2 (11600 - 11841 ms)
  if (ms >= 11600 && ms < 11841) {
    setSegmentLabel('Beat 10 (Slide F1/F2)');
    // Foto 1 slides left
    const tr1 = evalTransformAt2(ms);
    if (tr1) {
      drawCardTransform(canvas2Layar1, tr1.sx, tr1.sy, tr1.rot, tr1.dx, tr1.dy, tr1.flip);
    }

    // Foto 2 slides in from right
    const pTr = (ms - 11600.0) / (11841.0 - 11600.0);
    const uTr = evalEasing('cubicBezier 0.72 0.0 1.0 1.0', pTr);
    const sx2 = uTr;
    const sy2 = 0.8322;
    const dx2 = (1.0 - uTr) * 543.34 * S_COORD;

    // Geometric composite of Foto 2 over Foto 1 based on Foto 2's bounding box
    const xLeft = Math.max(0, Math.round(W / 2.0 + dx2 - (W / 2.0) * sx2));
    const xRight = Math.min(W, Math.round(W / 2.0 + dx2 + (W / 2.0) * sx2));
    if (xRight > xLeft) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(xLeft, 0, xRight - xLeft, H);
      ctx.clip();
      drawCardTransform(canvas2Layar2, sx2, sy2, 0.0, dx2, 0.0, 0.0);
      ctx.restore();
    }
    return;
  }

  // SEGMEN 4: Jedag-Jedug Main Beats (8258 - 15033 ms)
  if (ms < 15033) {
    const tr = evalTransformAt2(ms);
    if (tr) {
      setSegmentLabel(tr.label);
      const srcCanvas = tr.foto === 1 ? canvas2Layar1 : canvas2Layar2;
      drawCardTransform(srcCanvas, tr.sx, tr.sy, tr.rot, tr.dx, tr.dy, tr.flip);
    }
    return;
  }

  // SEGMEN 5: Beat 20 with Solid White Fade (15033 - 15425 ms)
  if (ms < 15425) {
    const tr = evalTransformAt2(ms);
    if (tr) {
      setSegmentLabel(tr.label);
      drawCardTransform(canvas2Layar2, tr.sx, tr.sy, tr.rot, tr.dx, tr.dy, tr.flip);
    }
    const pFade = Math.min(1.0, Math.max(0.0, (ms - 15033.0) / (15425.0 - 15033.0)));
    ctx.fillStyle = `rgba(255, 255, 255, ${pFade})`;
    ctx.fillRect(0, 0, W, H);
    return;
  }

  // SEGMEN 6: Outro Solid White (15425 - 17015 ms)
  setSegmentLabel('Outro');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
}

// =====================================================================
// PRESET 3 RENDER ENGINE: '#682 - Stelan Cuek' (60 FPS)
// 22 Beats, 2-Layar Vertical Split, 3D Flip & Oscillate Whip
// =====================================================================
function interpKfsDictJS(kfsList, relT, defaultVal = 1.0) {
  if (!kfsList || kfsList.length === 0) return defaultVal;
  if (kfsList.length === 1) return kfsList[0].v;

  const sortedKfs = kfsList.slice().sort((a, b) => a.t - b.t);
  if (relT <= sortedKfs[0].t) return sortedKfs[0].v;
  if (relT >= sortedKfs[sortedKfs.length - 1].t) return sortedKfs[sortedKfs.length - 1].v;

  for (let i = 0; i < sortedKfs.length - 1; i++) {
    const kf0 = sortedKfs[i];
    const kf1 = sortedKfs[i + 1];
    const t0 = kf0.t, v0 = kf0.v, e0 = kf0.e || 'None';
    const t1 = kf1.t, v1 = kf1.v, e1 = kf1.e || 'None';
    if (t0 <= relT && relT <= t1) {
      if (t1 === t0) return v0;
      const p = (relT - t0) / (t1 - t0);
      const u = evalEasing(e1, p);
      if (Array.isArray(v0)) {
        return v0.map((val, idx) => val + u * (v1[idx] - val));
      }
      return v0 + u * (v1 - v0);
    }
  }
  return sortedKfs[sortedKfs.length - 1].v;
}

function getSegmentAt3(ms) {
  if (typeof SEGMENTS3 === 'undefined') return null;
  if (ms < 1300) return { idx: 0, seg: SEGMENTS3[0], fotoNum: 0 };
  if (ms < 5016) return { idx: 1, seg: SEGMENTS3[1], fotoNum: 1 };
  if (ms < 9133) {
    for (let idx = 2; idx <= 11; idx++) {
      const seg = SEGMENTS3[idx];
      if (seg && ms >= seg.start && ms < seg.end) {
        return { idx, seg, fotoNum: 2 };
      }
    }
    return { idx: 11, seg: SEGMENTS3[11], fotoNum: 2 };
  }
  if (ms < 13266) {
    for (let idx = 12; idx <= 21; idx++) {
      const seg = SEGMENTS3[idx];
      if (seg && ms >= seg.start && ms < seg.end) {
        return { idx, seg, fotoNum: 3 };
      }
    }
    return { idx: 21, seg: SEGMENTS3[21], fotoNum: 3 };
  }
  return { idx: 21, seg: SEGMENTS3[21], fotoNum: 3 };
}

function renderFrame3(ms) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // SEGMEN 0: Intro Kinetic Typography "nona" & "stecu" (0 - 1300 ms)
  if (ms < 1300) {
    const tSec = ms / 1000.0;
    const swingAngle = -1.5 + 3.0 * 0.5 * (1.0 + Math.sin(2.0 * Math.PI * 2.0 * tSec));

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((swingAngle * Math.PI) / 180.0);

    if (ms < 650) {
      setSegmentLabel('Intro: "nona"');
      // "nona" pop bounce in (clean black on white)
      const pIn = Math.min(1.0, ms / 220.0);
      const sc = 0.8 + 0.25 * evalEasing('cubicBezier 0.34 1.56 0.64 1', pIn);

      ctx.scale(sc, sc);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 0;

      ctx.font = '800 100px "Outfit", "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#000000';
      ctx.fillText('nona', 0, 0);
    } else {
      setSegmentLabel('Intro: "stecu"');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 0;

      // "nona" upper
      ctx.font = '700 52px "Outfit", "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#52525b';
      ctx.fillText('nona', 0, -80);

      // "stecu" punch pop-in (bold clean black)
      const pStecu = Math.min(1.0, (ms - 650.0) / 200.0);
      const scStecu = 0.85 + 0.2 * evalEasing('cubicBezier 0.34 1.56 0.64 1', pStecu);

      ctx.save();
      ctx.scale(scStecu, scStecu);
      ctx.font = '900 106px "Outfit", "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#000000';
      ctx.fillText('stecu', 0, 24);
      ctx.restore();
    }

    ctx.restore();
    return;
  }

  const segInfo = getSegmentAt3(ms);
  if (!segInfo || !segInfo.seg) return;
  const { idx, seg, fotoNum } = segInfo;

  // Set active segment label
  if (fotoNum === 1) {
    if (ms < 2900) {
      setSegmentLabel('Foto 1 • "setelan cuek" (2-Layar)');
    } else {
      setSegmentLabel('Foto 1 • "aduhayy" (Pre-Drop)');
    }
  } else if (fotoNum === 2) {
    setSegmentLabel(`Foto 2 • Beat ${idx - 1}/10 (3D Flip & Whip)`);
  } else {
    setSegmentLabel(`Foto 3 • Beat ${idx - 11}/10 (Bounce & Snap)`);
  }

  // Source canvas selection
  let sourceCanvas = canvas2Layar1;
  if (fotoNum === 2) {
    sourceCanvas = canvas2Layar2;
  } else if (fotoNum === 3) {
    sourceCanvas = photo3Loaded ? canvas2Layar3 : canvas2Layar1;
  }

  const dur = Math.max(1.0, seg.end - seg.start);
  const relT = (ms - seg.start) / dur;

  // Scale, Rotation, Location
  const tData = seg.transform || {};
  let sc = [1.0, 1.0];
  if (Array.isArray(tData.scale)) {
    sc = interpKfsDictJS(tData.scale, relT, [1.0, 1.0]);
  } else if (typeof tData.scale === 'number') {
    sc = [tData.scale, tData.scale];
  }

  const sx = Array.isArray(sc) ? sc[0] : sc;
  const sy = Array.isArray(sc) && sc.length > 1 ? sc[1] : sx;

  let rot = 0.0;
  if (Array.isArray(tData.rotation)) {
    rot = interpKfsDictJS(tData.rotation, relT, 0.0);
  } else if (typeof tData.rotation === 'number') {
    rot = tData.rotation;
  }

  let loc = [540.0, 960.0];
  if (Array.isArray(tData.location) && tData.location.length > 0 && typeof tData.location[0] === 'object') {
    loc = interpKfsDictJS(tData.location, relT, [540.0, 960.0]);
  } else if (Array.isArray(tData.location) && tData.location.length >= 2) {
    loc = [tData.location[0], tData.location[1]];
  }

  const dx = (loc[0] - 540.0) * S_COORD;
  const dy = (loc[1] - 960.0) * S_COORD;

  // Oscillate & 3D Flip
  const effData = seg.effects || {};
  let oscDx = 0.0, oscDy = 0.0;
  if (effData.oscillate3) {
    const oProps = effData.oscillate3;
    const freq = Number(oProps.freq || 0.86);
    let mag = 81.0;
    if (Array.isArray(oProps.mag)) {
      mag = interpKfsDictJS(oProps.mag, relT, 81.0);
    } else if (typeof oProps.mag === 'number') {
      mag = oProps.mag;
    }

    let ang = -90.0;
    if (Array.isArray(oProps.angle)) {
      ang = interpKfsDictJS(oProps.angle, relT, -90.0);
    } else if (typeof oProps.angle === 'number') {
      ang = oProps.angle;
    }

    const tSec = Math.max(0.0, (ms - seg.start) / 1000.0);
    const theta = 2.0 * Math.PI * freq * tSec;
    const disp = mag * Math.sin(theta) * S_COORD;
    const rad = (ang * Math.PI) / 180.0;
    oscDx = disp * Math.cos(rad);
    oscDy = disp * Math.sin(rad);
  }

  let flipAngle = 0.0;
  if (effData.flip3) {
    const fProps = effData.flip3;
    if (Array.isArray(fProps.angle)) {
      flipAngle = interpKfsDictJS(fProps.angle, relT, 0.0);
    } else if (typeof fProps.angle === 'number') {
      flipAngle = fProps.angle;
    }
  }

  // Draw Card with 3D Flip, Scale & Rotation
  const totalDx = dx + oscDx;
  const totalDy = dy + oscDy;
  drawCardTransform(sourceCanvas, sx, sy, rot, totalDx, totalDy, flipAngle);

  // Overlay Center Seam Animated Lyrics Badge (Foto 1)
  if (fotoNum === 1) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cx = W / 2;
    const cy = H2;

    if (ms < 2900) {
      // 1.3s – 2.9s: "stelan cuek" (Clean white text with black outline/shadow, exactly like reference)
      const tScene = ms - 1300.0;
      const tBreath = tScene / 1000.0;
      const bScale = 1.0 + 0.03 * Math.sin(2.0 * Math.PI * 1.5 * tBreath);

      ctx.translate(cx, cy);
      ctx.scale(bScale, bScale);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // "stelan" enters with vertical bounce stretch
      const pStelan = Math.min(1.0, tScene / 220.0);
      const syStelan = 1.0 + 1.6 * (1.0 - evalEasing('cubicBezier 0.34 1.56 0.64 1', pStelan));

      // "cuek" enters at +433ms with vertical bounce stretch
      const tCuekScene = tScene - 433.0;
      const pCuek = tCuekScene > 0 ? Math.min(1.0, tCuekScene / 220.0) : 0;
      const syCuek = tCuekScene > 0 ? (1.0 + 1.6 * (1.0 - evalEasing('cubicBezier 0.34 1.56 0.64 1', pCuek))) : 0;

      ctx.font = '800 42px "Outfit", "Segoe UI", Roboto, sans-serif';
      
      // Draw "stelan" (left word)
      ctx.save();
      ctx.translate(-72, 0);
      ctx.scale(1.0, syStelan);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000000';
      ctx.strokeText('stelan', 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('stelan', 0, 0);
      ctx.restore();

      // Draw "cuek" (right word)
      if (tCuekScene > 0) {
        ctx.save();
        ctx.translate(72, 0);
        ctx.scale(1.0, syCuek);
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#000000';
        ctx.strokeText('cuek', 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('cuek', 0, 0);
        ctx.restore();
      }
    } else {
      // 2.9s – 5.01s: "aduhayy" leading to Drop Beat!
      const tAdu = (ms - 2900.0) / 1000.0;
      const bounceAdu = 1.0 + 0.05 * Math.sin(2.0 * Math.PI * 2.0 * tAdu);

      // Subtle translucent dark horizontal strip along center seam
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.fillRect(0, cy - 30, W, 60);

      ctx.translate(cx, cy);
      ctx.scale(bounceAdu, bounceAdu);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Bold pure white text with clean black outline & shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 2;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#000000';
      ctx.font = '900 52px "Outfit", "Segoe UI", Roboto, sans-serif';
      ctx.strokeText('aduhayy', 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('aduhayy', 0, 0);
    }

    ctx.restore();

    // Pre-drop white flash at 4950ms - 5016ms
    if (ms >= 4950 && ms < 5016) {
      const pFlash = (ms - 4950.0) / 66.0;
      ctx.fillStyle = `rgba(255, 255, 255, ${pFlash * 0.75})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // CATATAN: Watermark "#abilprikitiw", "9:16", dan "preset & video cek bio"
  // telah dihapus total dari Foto 2 & Foto 3 untuk hasil visual yang bersih dan profesional.

  // Outro Fade to Black (13266ms - 15215ms)
  if (ms > 13266) {
    const pFade = Math.min(1.0, Math.max(0.0, (ms - 13266.0) / 1949.0));
    ctx.fillStyle = `rgba(0, 0, 0, ${pFade})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// =====================================================================
// ANIMATION LOOP & SYNC
// =====================================================================
// =====================================================================
// NATIVE ANDROID OR HTML5 AUDIO CONTROLLER
// =====================================================================
function getPresetAudioFilename(presetId) {
  const p = presetId || currentPreset;
  return p === 3 ? 'audio3.m4a' : (p === 2 ? 'audio2.m4a' : 'audio.m4a');
}

let playbackStartPerfTime = 0;
let playbackStartMs = 0;
let isAudioPlaying = false;

function playNativeOrWebAudio(targetMs) {
  const filename = getPresetAudioFilename(currentPreset);
  if (window.AndroidNative && typeof window.AndroidNative.playAudio === 'function') {
    try {
      window.AndroidNative.playAudio(filename, Math.round(targetMs));
      isAudioPlaying = true;
    } catch (e) {
      console.warn("Native audio play failed:", e);
    }
  }

  try {
    audio.currentTime = targetMs / 1000.0;
    const p = audio.play();
    if (p !== undefined) {
      p.then(() => {
        isAudioPlaying = true;
      }).catch(err => {
        console.warn("HTML5 audio playback notice:", err);
      });
    }
  } catch (e) {
    console.warn("HTML5 audio play exception:", e);
  }
}

function pauseNativeOrWebAudio() {
  if (window.AndroidNative && typeof window.AndroidNative.pauseAudio === 'function') {
    try {
      window.AndroidNative.pauseAudio();
    } catch (e) {}
  }
  try {
    audio.pause();
  } catch (e) {}
  isAudioPlaying = false;
}

function seekNativeOrWebAudio(targetMs) {
  if (window.AndroidNative && typeof window.AndroidNative.seekAudio === 'function') {
    try {
      window.AndroidNative.seekAudio(Math.round(targetMs));
    } catch (e) {}
  }
  try {
    audio.currentTime = targetMs / 1000.0;
  } catch (e) {}
}

function setNativeOrWebAudioMuted(isMuted) {
  if (window.AndroidNative && typeof window.AndroidNative.setMuted === 'function') {
    try {
      window.AndroidNative.setMuted(isMuted);
    } catch (e) {}
  }
  audio.muted = isMuted;
}

// =====================================================================
// ANIMATION LOOP & SYNC (HIGH PRECISION FALLBACK CLOCK)
// =====================================================================
function animLoop() {
  if (isPlaying && !isScrubbing) {
    let ms = 0;
    if (window.AndroidNative && typeof window.AndroidNative.getCurrentPosition === 'function') {
      const nativePos = window.AndroidNative.getCurrentPosition();
      if (nativePos >= 0) {
        ms = nativePos;
      }
    }
    if (ms === 0 && !audio.paused && !isNaN(audio.currentTime) && audio.currentTime > 0) {
      ms = audio.currentTime * 1000.0;
    }
    if (ms === 0) {
      const elapsed = performance.now() - playbackStartPerfTime;
      ms = playbackStartMs + elapsed;
    }

    if (ms >= TOTAL_TIME_MS) {
      if (isLooping) {
        seekToMs(0);
        play();
      } else {
        pause();
        seekToMs(0);
      }
    } else {
      renderFrame(ms);
      updateTimelineUI(ms);
    }
  }
  animFrameId = requestAnimationFrame(animLoop);
}

function play() {
  isPlaying = true;
  bigPlayBtn.style.display = 'none';
  iconPlay.style.display = 'none';
  iconPause.style.display = 'block';

  let currentMs = 0;
  if (!isNaN(audio.currentTime) && audio.currentTime > 0) {
    currentMs = audio.currentTime * 1000.0;
  } else {
    currentMs = playbackStartMs;
  }
  if (currentMs >= TOTAL_TIME_MS) {
    currentMs = 0;
  }

  playbackStartPerfTime = performance.now();
  playbackStartMs = currentMs;

  playNativeOrWebAudio(currentMs);
}

function pause() {
  isPlaying = false;
  pauseNativeOrWebAudio();

  bigPlayBtn.style.display = 'flex';
  iconPlay.style.display = 'block';
  iconPause.style.display = 'none';
}

function togglePlay() {
  if (isPlaying) {
    pause();
  } else {
    play();
  }
}

function seekToMs(targetMs) {
  targetMs = Math.max(0, Math.min(TOTAL_TIME_MS, targetMs));
  playbackStartMs = targetMs;
  playbackStartPerfTime = performance.now();

  seekNativeOrWebAudio(targetMs);
  renderFrame(targetMs);
  updateTimelineUI(targetMs);
}

// Cached track width so per-frame updates only touch `transform` (GPU
// compositing) instead of `width`/`left` (which force a layout reflow
// on every single one of the 60 frames/sec during playback).
let trackWidthPx = timelineTrack.getBoundingClientRect().width;
window.addEventListener('resize', () => {
  trackWidthPx = timelineTrack.getBoundingClientRect().width;
});

let lastTimeLabel = '';

function updateTimelineUI(ms) {
  const frac = ms / TOTAL_TIME_MS;
  timelineFill.style.transform = `scaleX(${frac})`;
  timelineThumb.style.transform = `translateX(${frac * trackWidthPx}px)`;

  const s = ms / 1000.0;
  const mins = Math.floor(s / 60);
  const secs = (s % 60).toFixed(1).padStart(4, '0');
  const label = `${mins.toString().padStart(2, '0')}:${secs}`;
  if (label !== lastTimeLabel) {
    lastTimeLabel = label;
    timeCurrEl.textContent = label;
  }
}

// =====================================================================
// BEAT MARKERS IN SCRUBBER
// =====================================================================
function initBeatMarkers() {
  beatMarkersLayer.innerHTML = '';
  if (currentPreset === 3) {
    const beats3 = typeof BEAT_BOOKMARKS3 !== 'undefined' ? BEAT_BOOKMARKS3 : [
      1300, 5016, 5550, 5800, 6316, 6566, 7083, 7600, 7866, 8383, 8650,
      9133, 9666, 9950, 10433, 10700, 11200, 11716, 11966, 12500, 12750, 13266
    ];
    beats3.forEach((startMs, idx) => {
      const pct = (startMs / TOTAL_TIME_MS) * 100.0;
      const dot = document.createElement('div');
      dot.className = 'beat-mark';
      if ([0, 1, 11, 21].includes(idx)) dot.classList.add('major-beat');
      if ([2, 3, 4, 5, 6, 7, 8].includes(idx)) dot.classList.add('flip-beat');
      dot.style.left = `${pct}%`;
      dot.title = `Beat ${idx + 1} (${(startMs / 1000.0).toFixed(2)}s)`;
      beatMarkersLayer.appendChild(dot);
    });
  } else if (currentPreset === 2) {
    BEAT_MAP2.forEach((b, idx) => {
      const pct = (b.start / TOTAL_TIME_MS) * 100.0;
      const dot = document.createElement('div');
      dot.className = 'beat-mark';
      if ([0, 9, 10, 19].includes(idx)) dot.classList.add('major-beat');
      if ([4, 5, 11].includes(idx)) dot.classList.add('flip-beat');
      dot.style.left = `${pct}%`;
      dot.title = b.label;
      beatMarkersLayer.appendChild(dot);
    });
  } else {
    BEAT_BOOKMARKS.forEach((b, idx) => {
      const pct = (b.start / TOTAL_TIME_MS) * 100.0;
      const dot = document.createElement('div');
      dot.className = 'beat-mark';
      if (idx < 4) dot.classList.add('major-beat');
      if (SHAPES_DATA[b.id] && SHAPES_DATA[b.id].flipKfs) dot.classList.add('flip-beat');
      dot.style.left = `${pct}%`;
      dot.title = b.label;
      beatMarkersLayer.appendChild(dot);
    });
  }
}

// Timeline scrubbing
function handleTimelineSeek(e) {
  const rect = timelineTrack.getBoundingClientRect();
  const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const pct = clickX / rect.width;
  const targetMs = pct * TOTAL_TIME_MS;
  seekToMs(targetMs);
}

timelineTrack.addEventListener('mousedown', (e) => {
  isScrubbing = true;
  handleTimelineSeek(e);
});

// mousemove can fire far more often than the screen can redraw; coalesce
// to at most one seek+render per animation frame while dragging instead
// of re-rendering the canvas on every raw pointer event.
let pendingScrubEvent = null;
let scrubFrameQueued = false;
window.addEventListener('mousemove', (e) => {
  if (!isScrubbing) return;
  pendingScrubEvent = e;
  if (!scrubFrameQueued) {
    scrubFrameQueued = true;
    requestAnimationFrame(() => {
      scrubFrameQueued = false;
      if (pendingScrubEvent) {
        handleTimelineSeek(pendingScrubEvent);
        pendingScrubEvent = null;
      }
    });
  }
});

window.addEventListener('mouseup', () => {
  if (isScrubbing) {
    isScrubbing = false;
  }
});

// Controls
btnPlayPause.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  togglePlay();
});

bigPlayBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  togglePlay();
});

// Tap pada layar video 9:16 langsung memainkan / menjeda video
const canvasViewport = document.getElementById('canvas-viewport');
if (canvasViewport) {
  canvasViewport.addEventListener('click', (e) => {
    if (e.target === bigPlayBtn || bigPlayBtn.contains(e.target)) return;
    togglePlay();
  });
}

btnReplay.addEventListener('click', () => {
  seekToMs(0);
  play();
});

btnMute.addEventListener('click', () => {
  audio.muted = !audio.muted;
  setNativeOrWebAudioMuted(audio.muted);
  if (audio.muted) {
    iconVol.style.display = 'none';
    iconMute.style.display = 'block';
  } else {
    iconVol.style.display = 'block';
    iconMute.style.display = 'none';
  }
});

btnLoop.addEventListener('click', () => {
  isLooping = !isLooping;
  btnLoop.classList.toggle('active', isLooping);
});

btnFullscreen.addEventListener('click', () => {
  const container = document.getElementById('canvas-viewport');
  if (!document.fullscreenElement) {
    container.requestFullscreen?.() || container.webkitRequestFullscreen?.();
  } else {
    document.exitFullscreen?.() || document.webkitExitFullscreen?.();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    togglePlay();
  }
});

// =====================================================================
// PHOTO FRAMING SLIDERS SETUP (PAN X/Y & ZOOM)
// =====================================================================
// Berapa jauh foto boleh digeser (dalam px hasil scale) supaya tidak
// pernah kehabisan ruang geser sebelum benar-benar mentok di tepi foto,
// dan tidak menyisakan sisa slider yang tidak berefek sama sekali.
const framingRefresh = {};

function setupFramingControls(slotNum, slotKey, getImg, targetCtx) {
  const rangeY = document.getElementById(`range-y-${slotNum}`);
  const rangeX = document.getElementById(`range-x-${slotNum}`);
  const rangeZoom = document.getElementById(`range-zoom-${slotNum}`);
  const valY = document.getElementById(`val-y-${slotNum}`);
  const valX = document.getElementById(`val-x-${slotNum}`);
  const valZoom = document.getElementById(`val-zoom-${slotNum}`);
  const btnReset = document.getElementById(`btn-reset-${slotNum}`);

  // Set wide, smooth interactive slider bounds
  if (rangeY) {
    rangeY.min = -350;
    rangeY.max = 350;
    rangeY.step = 1;
  }
  if (rangeX) {
    rangeX.min = -300;
    rangeX.max = 300;
    rangeX.step = 1;
  }
  if (rangeZoom) {
    rangeZoom.min = 1.0;
    rangeZoom.max = 2.5;
    rangeZoom.step = 0.02;
  }

  function applyChange() {
    photoTransforms[slotKey].y = parseFloat(rangeY.value) || 0;
    photoTransforms[slotKey].zoom = parseFloat(rangeZoom.value) || 1.0;
    if (valY) valY.textContent = `${Math.round(rangeY.value)} px`;
    if (valZoom) valZoom.textContent = `${parseFloat(rangeZoom.value).toFixed(2)}x`;

    if (rangeX) {
      photoTransforms[slotKey].x = parseFloat(rangeX.value) || 0;
      if (valX) valX.textContent = `${Math.round(rangeX.value)} px`;
    }

    // Update 2-layar base canvas
    update2LayarCanvas(targetCtx, getImg(), photoTransforms[slotKey]);

    // Update thumbnail CSS transform in slot card
    const thumbImg = document.getElementById(`thumb-${slotNum}`);
    if (thumbImg) {
      const pZ = photoTransforms[slotKey].zoom;
      const pX = (photoTransforms[slotKey].x || 0) * 0.12;
      const pY = (photoTransforms[slotKey].y || 0) * 0.12;
      thumbImg.style.transform = `scale(${pZ}) translate(${pX}px, ${pY}px)`;
    }

    // Auto-preview in player stage if currently paused at Intro (so user immediately sees changes)
    if (audio.paused && !isPlaying) {
      if (slotKey === 'foto1') {
        const introLimit = currentPreset === 2 ? 7.8 : 2.0;
        const targetTime = currentPreset === 2 ? 8.25 : 2.5;
        if (audio.currentTime < introLimit || (currentPreset === 2 && audio.currentTime >= 11.8)) {
          audio.currentTime = targetTime;
          updateTimelineUI(targetTime * 1000.0);
        }
      } else if (slotKey === 'foto2') {
        const targetTime = currentPreset === 2 ? 12.0 : 8.5;
        const f2Start = currentPreset === 2 ? 11.6 : 8.2;
        if (audio.currentTime < f2Start) {
          audio.currentTime = targetTime;
          updateTimelineUI(targetTime * 1000.0);
        }
      }
    }

    renderFrame(audio.currentTime * 1000.0);
  }

  if (rangeY) rangeY.addEventListener('input', applyChange);
  if (rangeZoom) rangeZoom.addEventListener('input', applyChange);
  if (rangeX) rangeX.addEventListener('input', applyChange);

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (rangeY) rangeY.value = 0;
      if (rangeZoom) rangeZoom.value = 1.0;
      if (rangeX) rangeX.value = 0;
      applyChange();
    });
  }

  framingRefresh[slotKey] = applyChange;
}

// Global reset helper
window.resetFraming = function(slotKey) {
  const slotNum = slotKey === 'foto1' ? 1 : (slotKey === 'foto2' ? 2 : 3);
  const rangeY = document.getElementById(`range-y-${slotNum}`);
  const rangeX = document.getElementById(`range-x-${slotNum}`);
  const rangeZoom = document.getElementById(`range-zoom-${slotNum}`);
  if (rangeY) rangeY.value = 0;
  if (rangeX) rangeX.value = 0;
  if (rangeZoom) rangeZoom.value = 1.0;
  if (framingRefresh[slotKey]) {
    framingRefresh[slotKey]();
  }
};

setupFramingControls(1, 'foto1', () => photo1Img, ctx2Layar1);
setupFramingControls(2, 'foto2', () => photo2Img, ctx2Layar2);
setupFramingControls(3, 'foto3', () => photo3Img, ctx2Layar3);

// =====================================================================
// PHOTO UPLOAD & SLOT MANAGEMENT
// =====================================================================
function setupPhotoSlot(slotNum, inputId, dropId, emptyId, thumbId, onUploaded) {
  const fileInput = document.getElementById(inputId);
  const dropZone = document.getElementById(dropId);
  const emptyView = document.getElementById(emptyId);
  const thumbImg = document.getElementById(thumbId);

  function loadFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    thumbImg.src = url;
    thumbImg.style.display = 'block';
    emptyView.style.display = 'none';

    const formData = new FormData();
    formData.append('file', file);
    fetch('/api/upload', {
      method: 'POST',
      body: formData
    })
    .then(res => res.json())
    .then(data => {
      onUploaded(url, data.filename);
    })
    .catch(err => {
      console.error("Upload error:", err);
      onUploaded(url, null);
    });
  }

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      loadFile(e.target.files[0]);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-active');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-active');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-active');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadFile(e.dataTransfer.files[0]);
    }
  });
}

setupPhotoSlot(1, 'file-1', 'drop-1', 'empty-1', 'thumb-1', (url, filename) => {
  photo1Img.src = url;
  photo1Img.onload = () => {
    photo1Loaded = true;
    framingRefresh.foto1();
  };
  if (filename) photo1Filename = filename;
});

setupPhotoSlot(2, 'file-2', 'drop-2', 'empty-2', 'thumb-2', (url, filename) => {
  photo2Img.src = url;
  photo2Img.onload = () => {
    photo2Loaded = true;
    framingRefresh.foto2();
  };
  if (filename) photo2Filename = filename;
});

setupPhotoSlot(3, 'file-3', 'drop-3', 'empty-3', 'thumb-3', (url, filename) => {
  if (!photo3Img) photo3Img = new Image();
  photo3Img.src = url;
  photo3Img.onload = () => {
    photo3Loaded = true;
    framingRefresh.foto3();
  };
  if (filename) photo3Filename = filename;
});

// Load Default Photos (Local Assets Fallback for APK)
function applyLocalDefaultPhotos() {
  if (!photo1Loaded) {
    photo1Img.src = 'foto1.jpg';
    photo1Img.onload = () => {
      photo1Loaded = true;
      const t1 = document.getElementById('thumb-1');
      if (t1) { t1.src = 'foto1.jpg'; t1.style.display = 'block'; }
      const e1 = document.getElementById('empty-1');
      if (e1) e1.style.display = 'none';
      if (framingRefresh.foto1) framingRefresh.foto1();
    };
    photo1Filename = 'foto1.jpg';
  }
  if (!photo2Loaded) {
    photo2Img.src = 'foto2.jpg';
    photo2Img.onload = () => {
      photo2Loaded = true;
      const t2 = document.getElementById('thumb-2');
      if (t2) { t2.src = 'foto2.jpg'; t2.style.display = 'block'; }
      const e2 = document.getElementById('empty-2');
      if (e2) e2.style.display = 'none';
      if (framingRefresh.foto2) framingRefresh.foto2();
    };
    photo2Filename = 'foto2.jpg';
  }
  if (!photo3Loaded) {
    if (!photo3Img) photo3Img = new Image();
    photo3Img.src = 'foto3.jpg';
    photo3Img.onload = () => {
      photo3Loaded = true;
      const t3 = document.getElementById('thumb-3');
      if (t3) { t3.src = 'foto3.jpg'; t3.style.display = 'block'; }
      const e3 = document.getElementById('empty-3');
      if (e3) e3.style.display = 'none';
      if (framingRefresh.foto3) framingRefresh.foto3();
    };
    photo3Filename = 'foto3.jpg';
  }
}

function loadDefaultPhotos() {
  fetch('/api/defaults')
    .then(res => res.json())
    .then(data => {
      if (data.foto1) {
        photo1Img.src = data.foto1;
        photo1Img.onload = () => {
          photo1Loaded = true;
          document.getElementById('thumb-1').src = data.foto1;
          document.getElementById('thumb-1').style.display = 'block';
          document.getElementById('empty-1').style.display = 'none';
          framingRefresh.foto1();
        };
        photo1Filename = 'foto1.jpg';
      }
      if (data.foto2) {
        photo2Img.src = data.foto2;
        photo2Img.onload = () => {
          photo2Loaded = true;
          document.getElementById('thumb-2').src = data.foto2;
          document.getElementById('thumb-2').style.display = 'block';
          document.getElementById('empty-2').style.display = 'none';
          framingRefresh.foto2();
        };
        photo2Filename = 'foto2.jpg';
      }
      if (data.foto3) {
        if (!photo3Img) photo3Img = new Image();
        photo3Img.src = data.foto3;
        photo3Img.onload = () => {
          photo3Loaded = true;
          const thumb3 = document.getElementById('thumb-3');
          const empty3 = document.getElementById('empty-3');
          if (thumb3) {
            thumb3.src = data.foto3;
            thumb3.style.display = 'block';
          }
          if (empty3) empty3.style.display = 'none';
          if (framingRefresh.foto3) framingRefresh.foto3();
        };
        photo3Filename = 'foto3.jpg';
      }
    })
    .catch(err => {
      console.log("Default photos check, applying local fallback:", err);
      applyLocalDefaultPhotos();
    });
}

btnDefaultPhotos.addEventListener('click', loadDefaultPhotos);

// Swap Photos
btnSwapPhotos.addEventListener('click', () => {
  const tempSrc = photo1Img.src;
  const tempFn = photo1Filename;
  const tempLoaded = photo1Loaded;

  photo1Img.src = photo2Img.src;
  photo1Filename = photo2Filename;
  photo1Loaded = photo2Loaded;

  photo2Img.src = tempSrc;
  photo2Filename = tempFn;
  photo2Loaded = tempLoaded;

  document.getElementById('thumb-1').src = photo1Img.src;
  document.getElementById('thumb-2').src = photo2Img.src;

  framingRefresh.foto1();
  framingRefresh.foto2();
});

// =====================================================================
// EXPORT & RENDER PIPELINE WITH CROP CONFIGS
// =====================================================================
let renderPollTimer = null;

btnRender.addEventListener('click', () => {
  btnRender.disabled = true;
  renderBtnText.textContent = 'Memulai Render...';
  renderProgressBox.style.display = 'flex';
  progressBarFill.style.width = '0%';
  renderPctText.textContent = '0%';
  renderStatusText.textContent = 'Mengirim antrean render dengan posisi foto...';

  const formData = new FormData();
  formData.append('foto1', photo1Filename);
  formData.append('foto2', photo2Filename);
  if (photo3Filename) {
    formData.append('foto3', photo3Filename);
  }
  formData.append('crop_json', JSON.stringify(photoTransforms));
  formData.append('preset', String(currentPreset));

  fetch('/api/render', {
    method: 'POST',
    body: formData
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      alert("Error: " + data.error);
      resetRenderUI();
      return;
    }
    pollRenderProgress();
  })
  .catch(err => {
    alert("Gagal memulai render: " + err);
    resetRenderUI();
  });
});

function pollRenderProgress() {
  if (renderPollTimer) clearInterval(renderPollTimer);

  renderPollTimer = setInterval(() => {
    fetch('/api/progress')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'rendering') {
          const pct = data.progress || 0;
          progressBarFill.style.width = `${pct}%`;
          renderPctText.textContent = `${pct}%`;
          renderStatusText.textContent = `Memproses frame (${pct}%)...`;
        } else if (data.status === 'done') {
          clearInterval(renderPollTimer);
          progressBarFill.style.width = '100%';
          renderPctText.textContent = '100%';
          renderStatusText.textContent = 'Selesai! Mengunduh video MP4...';
          renderBtnText.textContent = '✦ RENDER SELESAI! ✦';

          if (data.video_url) {
            const a = document.createElement('a');
            a.href = data.video_url;
            a.download = currentPreset === 3 ? 'hasil_jedag_jedug3.mp4' : (currentPreset === 2 ? 'hasil_jedag_jedug2.mp4' : 'hasil_jedag_jedug.mp4');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }

          setTimeout(() => {
            resetRenderUI();
          }, 3500);
        } else if (data.status === 'error') {
          clearInterval(renderPollTimer);
          alert("Render error: " + data.error);
          resetRenderUI();
        }
      })
      .catch(err => {
        console.error("Poll error:", err);
      });
  }, 400);
}

function resetRenderUI() {
  btnRender.disabled = false;
  renderBtnText.textContent = 'RENDER & UNDUH VIDEO MP4';
  renderProgressBox.style.display = 'none';
}

// =====================================================================
// PRESETS CATALOG & MODULAR REGISTRY (CLEAN & NEO-BRUTALIST TEMPLATES)
// =====================================================================
const PRESETS_DATA = [
  {
    id: 1,
    title: 'JANGAN HARAP',
    templateLabel: 'TEMPLATE 1',
    artist: 'Jedag-Jedug 16 Kicks',
    tag: 'TEMPLATE 1',
    tagClass: 'tag-sunset',
    bannerClass: 'banner-sunset',
    subBadge: 'MOTION JJ 16 KICKS',
    tempo: '130 BPM',
    beats: '16 Kicks',
    duration: '18.91s',
    totalMs: TOTAL_TIME_MS1,
    audioUrl: 'audio.m4a',
    photoCount: '2–3 Foto',
    desc: 'Transisi goyang presisi dengan efek 3D perspective, bounce sinkron, dan zoom drop tepat pada kick bass.',
    isAvailable: true
  },
  {
    id: 2,
    title: 'JJ SO ASU',
    templateLabel: 'TEMPLATE 2',
    artist: 'Drop Beat 20 Kicks',
    tag: 'TEMPLATE 2',
    tagClass: 'tag-emerald',
    bannerClass: 'banner-emerald',
    subBadge: 'ROTASI GEOMETRIC SLICE',
    tempo: '134 BPM',
    beats: '20 Beats',
    duration: '17.01s',
    totalMs: TOTAL_TIME_MS2,
    audioUrl: 'audio2.m4a',
    photoCount: '2 Foto',
    desc: 'Transisi slice horizontal dinamis, ayunan rotasi ritmis, dan drop beat energetik dengan outro fade putih.',
    isAvailable: true
  },
  {
    id: 3,
    title: 'JJ STECU',
    templateLabel: 'TEMPLATE 3',
    artist: 'Setelan Cuek &bull; 22 Beats &bull; 3 Foto',
    tag: 'TEMPLATE 3',
    tagClass: 'tag-amber',
    bannerClass: 'banner-amber',
    subBadge: '2-LAYAR SPLIT STECU',
    tempo: '132 BPM',
    beats: '22 Beats',
    duration: '15.21s',
    totalMs: TOTAL_TIME_MS3,
    audioUrl: 'audio3.m4a',
    photoCount: '3 Foto',
    desc: 'Format 2-layar vertikal split, tipografi pembuka, transisi 3D flip, dan 22 beat kicks drop terkalibrasi.',
    isAvailable: true
  }
];

let activePreviewPresetId = null;

function renderCatalog() {
  if (!catalogGrid) return;
  catalogGrid.innerHTML = '';

  PRESETS_DATA.forEach(preset => {
    const card = document.createElement('article');
    card.className = `catalog-card ${preset.isAvailable ? '' : 'coming-soon'}`;
    card.id = `catalog-card-${preset.id}`;

    if (preset.isAvailable) {
      card.innerHTML = `
        <div class="card-template-banner ${preset.bannerClass}">
          <div class="banner-badge-corner">${preset.tag}</div>
          <div class="banner-content">
            <h2 class="banner-big-title">${preset.templateLabel}</h2>
            <div class="banner-sub-tag">${preset.subBadge}</div>
          </div>
        </div>

        <div class="card-details">
          <div class="card-header-info">
            <h3 class="preset-title">${preset.title}</h3>
            <p class="preset-artist">${preset.artist}</p>
          </div>

          <div class="preset-meta-chips">
            <span class="meta-chip">Tempo: ${preset.tempo}</span>
            <span class="meta-chip">Beats: ${preset.beats}</span>
            <span class="meta-chip">Durasi: ${preset.duration}</span>
            <span class="meta-chip">Slot: ${preset.photoCount}</span>
          </div>

          <p class="preset-summary">${preset.desc}</p>

          <div class="card-actions">
            <button type="button" class="btn-preview-audio" data-id="${preset.id}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Dengarkan Musik</span>
            </button>
            <button type="button" class="btn-select-preset" data-id="${preset.id}">
              <span>Buka di Studio</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      `;
    } else {
      card.innerHTML = `
        <div class="card-template-banner ${preset.bannerClass}">
          <div class="banner-badge-corner">${preset.tag}</div>
          <div class="banner-content">
            <h2 class="banner-big-title">${preset.templateLabel}</h2>
            <div class="banner-sub-tag">SEGERA HADIR</div>
          </div>
        </div>

        <div class="card-details">
          <div class="card-header-info">
            <h3 class="preset-title">${preset.title}</h3>
            <p class="preset-artist">${preset.artist}</p>
          </div>

          <div class="preset-meta-chips">
            <span class="meta-chip">Tempo: ${preset.tempo}</span>
            <span class="meta-chip">Beats: ${preset.beats}</span>
            <span class="meta-chip">Slot: ${preset.photoCount}</span>
          </div>

          <p class="preset-summary">${preset.desc}</p>

          <div class="card-actions">
            <button type="button" class="btn-select-preset disabled" disabled>
              <span>Segera Hadir</span>
            </button>
          </div>
        </div>
      `;
    }

    catalogGrid.appendChild(card);
  });

  // Attach event listeners to card buttons
  document.querySelectorAll('.btn-preview-audio').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetId = Number(btn.dataset.id);
      toggleCatalogAudioPreview(presetId);
    });
  });

  document.querySelectorAll('.btn-select-preset[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetId = Number(btn.dataset.id);
      openStudio(presetId);
    });
  });
}

function toggleCatalogAudioPreview(presetId) {
  const targetPreset = PRESETS_DATA.find(p => p.id === presetId);
  if (!targetPreset || !targetPreset.audioUrl) return;

  if (activePreviewPresetId === presetId && !catalogPreviewPlayer.paused) {
    catalogPreviewPlayer.pause();
    catalogPreviewPlayer.currentTime = 0;
    activePreviewPresetId = null;
    updatePreviewButtonsState();
    return;
  }

  catalogPreviewPlayer.pause();
  catalogPreviewPlayer.src = targetPreset.audioUrl;
  catalogPreviewPlayer.currentTime = 0;
  catalogPreviewPlayer.play().then(() => {
    activePreviewPresetId = presetId;
    updatePreviewButtonsState();
  }).catch(err => {
    console.warn("Audio preview play error:", err);
  });
}

function updatePreviewButtonsState() {
  document.querySelectorAll('.btn-preview-audio').forEach(btn => {
    const pid = Number(btn.dataset.id);
    const labelSpan = btn.querySelector('span');
    const svgIcon = btn.querySelector('svg');
    if (activePreviewPresetId === pid && !catalogPreviewPlayer.paused) {
      btn.classList.add('playing');
      if (labelSpan) labelSpan.textContent = 'Hentikan Musik';
      if (svgIcon) svgIcon.innerHTML = '<rect x="6" y="6" width="12" height="12"/>';
    } else {
      btn.classList.remove('playing');
      if (labelSpan) labelSpan.textContent = 'Dengarkan Musik';
      if (svgIcon) svgIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    }
  });
}

if (catalogPreviewPlayer) {
  catalogPreviewPlayer.addEventListener('ended', () => {
    activePreviewPresetId = null;
    updatePreviewButtonsState();
  });
}

function openStudio(presetId) {
  // Stop audio preview if playing
  if (catalogPreviewPlayer && !catalogPreviewPlayer.paused) {
    catalogPreviewPlayer.pause();
    catalogPreviewPlayer.currentTime = 0;
    activePreviewPresetId = null;
    updatePreviewButtonsState();
  }

  if (catalogView) catalogView.style.display = 'none';
  if (studioView) studioView.style.display = 'block';

  if (windowTitleText) {
    const tNames = { 1: 'TEMPLATE 1: JANGAN HARAP', 2: 'TEMPLATE 2: JJ SO ASU', 3: 'TEMPLATE 3: JJ STECU' };
    windowTitleText.innerHTML = `<span class="brand-x">X</span>EDITZ &bull; [${tNames[presetId] || 'Studio'}]`;
  }

  requestAnimationFrame(() => {
    if (timelineTrack) {
      trackWidthPx = timelineTrack.getBoundingClientRect().width || 360;
    }
  });

  switchPreset(presetId, true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openCatalog() {
  pause();

  if (studioView) studioView.style.display = 'none';
  if (catalogView) catalogView.style.display = 'block';

  if (windowTitleText) {
    windowTitleText.innerHTML = `<span class="brand-x">X</span>EDITZ &bull; [Katalog Template]`;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

if (btnBackCatalog) {
  btnBackCatalog.addEventListener('click', openCatalog);
}

// =====================================================================
// PRESET SWITCHING & STUDIO CONFIGURATION
// =====================================================================
function switchPreset(preset, force = false) {
  if (preset === currentPreset && !force) return;
  const wasPlaying = isPlaying;
  pause();

  currentPreset = preset;
  TOTAL_TIME_MS = preset === 3 ? TOTAL_TIME_MS3 : (preset === 2 ? TOTAL_TIME_MS2 : TOTAL_TIME_MS1);

  if (btnQuick1) btnQuick1.classList.toggle('active', preset === 1);
  if (btnQuick2) btnQuick2.classList.toggle('active', preset === 2);
  if (btnQuick3) btnQuick3.classList.toggle('active', preset === 3);

  audio.src = getPresetAudioFilename(preset);
  audio.load();

  const metaTempo = document.getElementById('meta-tempo');
  const metaBeats = document.getElementById('meta-beats');
  const metaDurasi = document.getElementById('meta-durasi');
  const slot1Desc = document.querySelector('#card-slot-1 .slot-desc');
  const slot2Desc = document.querySelector('#card-slot-2 .slot-desc');
  const slot3Desc = document.querySelector('#card-slot-3 .slot-desc');

  if (preset === 3) {
    if (activePresetLabel) activePresetLabel.innerHTML = 'SEDANG AKTIF: TEMPLATE 3 &bull; JJ STECU';
    if (metaTempo) metaTempo.textContent = '132 BPM';
    if (metaBeats) metaBeats.textContent = '22 Beats';
    if (metaDurasi) metaDurasi.textContent = '15.21s';
    if (timeTotalEl) timeTotalEl.textContent = '00:15.2';
    if (slot1Desc) slot1Desc.innerHTML = 'Intro &bull; Foto 1 (JJ STECU 1.3s–5.0s)';
    if (slot2Desc) slot2Desc.innerHTML = 'Foto 2 &bull; Beat 1–10 (Drop 3D Flip 5.0s–9.1s)';
    if (slot3Desc) slot3Desc.innerHTML = 'Foto 3 &bull; Beat 11–22 (Drop Snaps 9.1s–13.2s)';
  } else if (preset === 2) {
    if (activePresetLabel) activePresetLabel.innerHTML = 'SEDANG AKTIF: TEMPLATE 2 &bull; JJ SO ASU';
    if (metaTempo) metaTempo.textContent = '134 BPM';
    if (metaBeats) metaBeats.textContent = '20 Beats';
    if (metaDurasi) metaDurasi.textContent = '17.01s';
    if (timeTotalEl) timeTotalEl.textContent = '00:17.0';
    if (slot1Desc) slot1Desc.innerHTML = 'Intro &bull; Beat 1–10 (JJ SO ASU)';
    if (slot2Desc) slot2Desc.innerHTML = 'Beat 11–20 (Drop & Rotation)';
    if (slot3Desc) slot3Desc.innerHTML = 'Slot Foto Cadangan / Tambahan';
  } else {
    if (activePresetLabel) activePresetLabel.innerHTML = 'SEDANG AKTIF: TEMPLATE 1 &bull; JANGAN HARAP';
    if (metaTempo) metaTempo.textContent = '130 BPM';
    if (metaBeats) metaBeats.textContent = '16 Kicks';
    if (metaDurasi) metaDurasi.textContent = '18.91s';
    if (timeTotalEl) timeTotalEl.textContent = '00:18.9';
    if (slot1Desc) slot1Desc.innerHTML = 'Intro &bull; "JANGAN HARAP" &bull; Beat 1–8';
    if (slot2Desc) slot2Desc.innerHTML = 'Beat 9–16 (Main Jedag-Jedug)';
    if (slot3Desc) slot3Desc.innerHTML = 'Slot Foto Cadangan / Tambahan';
  }

  initBeatMarkers();
  seekToMs(0);
  if (wasPlaying) play();
}

if (btnQuick1) btnQuick1.addEventListener('click', () => switchPreset(1));
if (btnQuick2) btnQuick2.addEventListener('click', () => switchPreset(2));
if (btnQuick3) btnQuick3.addEventListener('click', () => switchPreset(3));

// =====================================================================
// IPAD CLOCK & STATUS BAR REAL-TIME
// =====================================================================
function updateIpadClock() {
  const clockEl = document.getElementById('ipad-clock');
  if (clockEl) {
    const now = new Date();
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    clockEl.textContent = `${hrs}:${mins}`;
  }
}
updateIpadClock();
setInterval(updateIpadClock, 10000);

// =====================================================================
// AUTO-DETECT DEVICE & ULTRA-SMOOTH MOBILE PERFORMANCE (ANTI-LEMOT)
// =====================================================================
function detectDeviceMode() {
  const isMobileScreen = window.innerWidth <= 768;
  const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                            navigator.userAgent.includes('XPrestApp') ||
                            navigator.userAgent.includes('wv');
  
  if (isMobileScreen || isMobileUserAgent) {
    document.body.classList.add('is-mobile-app');
  } else {
    document.body.classList.remove('is-mobile-app');
  }
}
window.addEventListener('resize', detectDeviceMode);
window.addEventListener('orientationchange', detectDeviceMode);
detectDeviceMode();

// =====================================================================
// INITIALIZATION
// =====================================================================
renderCatalog();
openCatalog();
initBeatMarkers();
applyLocalDefaultPhotos();
loadDefaultPhotos();
renderFrame(0);
requestAnimationFrame(animLoop);

