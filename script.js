
/* ================================================================
   GLOBAL STATE
================================================================ */
let imgData = null;   // original proportional ImageData
let grayData = null;   // grayscale ImageData
let imgW = 0;
let imgH = 0;

let chartRGB = null;
let chartGray = null;
let chartHSV = null;
let chartNorm = null;  // TAMBAHAN: instance chart histogram normalisasi

// Normalisasi gambar (Min-Max)
let chartNormBefore = null;  // chart histogram sebelum normalisasi
let chartNormAfter = null;  // chart histogram sesudah normalisasi
let currentNormMode = 'gray'; // 'gray' atau 'rgb'

/* ================================================================
   SCROLL REVEAL
================================================================ */
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.05 });

document.querySelectorAll('.section').forEach(s => observer.observe(s));

// Langsung tampilkan section pertama tanpa scroll
['sec-upload', 'sec-gray'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.classList.add('visible');
});

/* ================================================================
   SLIDER RANGE GRADIENT SYNC
================================================================ */
function syncSliderGradient(input) {
  const min = +input.min, max = +input.max, val = +input.value;
  const pct = ((val - min) / (max - min)) * 100;
  input.style.setProperty('--val', pct + '%');
}

document.querySelectorAll('input[type="range"]').forEach(r => {
  syncSliderGradient(r);
  r.addEventListener('input', () => syncSliderGradient(r));
});

/* ================================================================
   FILE UPLOAD HANDLING
================================================================ */
const fileInput = document.getElementById('file-input');
const uploadZone = document.getElementById('upload-zone');

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) processFile(file);
});
fileInput.addEventListener('change', e => {
  if (e.target.files[0]) processFile(e.target.files[0]);
});

/**
 * Memproses file gambar yang diupload:
 * - Resize proporsional ke lebar 300px
 * - Simpan ImageData ke state global
 * - Tampilkan info file
 * - Jalankan seluruh proses pengolahan citra
 */
function processFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    // Hitung dimensi proporsional (lebar 300px)
    const origW = img.naturalWidth;
    const origH = img.naturalHeight;
    const newW = 300;
    const newH = Math.round(origH * (newW / origW));
    imgW = newW;
    imgH = newH;

    // Gambar ke offscreen canvas untuk ambil ImageData
    const offscreen = document.createElement('canvas');
    offscreen.width = newW;
    offscreen.height = newH;
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(img, 0, 0, newW, newH);
    imgData = ctx.getImageData(0, 0, newW, newH);

    // Tampilkan info file
    document.getElementById('info-name').textContent = file.name;
    document.getElementById('info-size').textContent = formatBytes(file.size);
    document.getElementById('info-res').textContent = `${origW} × ${origH} px`;
    document.getElementById('info-display-res').textContent = `${newW} × ${newH} px`;
    document.getElementById('info-type').textContent = file.type;
    document.getElementById('original-display').classList.remove('hidden');
    document.getElementById('file-info').classList.remove('hidden');

    // Render gambar asli
    renderImageDataToCanvas('canvas-original', imgData, newW, newH);

    // Jalankan semua proses pengolahan citra
    computeGrayscale();

    // TAMBAHAN: Eksekusi normalisasi histogram tepat setelah grayscale siap
    computeNormalization();

    showAllSections();

    URL.revokeObjectURL(url);
  };

  img.src = url;
}

/** Format ukuran file ke satuan yang terbaca manusia */
function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

/** Tampilkan semua section setelah gambar diupload */
function showAllSections() {
  ['gray', 'binary', 'arith', 'logic', 'hist', 'norm', 'conv', 'morph'].forEach(key => {
    const ph = document.getElementById(key + '-placeholder');
    const ct = document.getElementById(key + '-content');
    if (ph) ph.classList.add('hidden');
    if (ct) ct.classList.remove('hidden');
  });

  renderBinary();
  renderBinaryOtsu();   // ← OTSU
  renderBrightness();
  renderContrast();
  renderBitand();
  renderNot();
  buildHistograms();
  buildImageNormalization();
  buildConvolutions();
  buildMorphology();

  // Aktifkan panel Download All setelah semua selesai
  requestAnimationFrame(() => updateDownloadAllPanel());
}

/* ================================================================
   HELPER: Render ImageData ke elemen canvas berdasarkan ID
================================================================ */
function renderImageDataToCanvas(canvasId, data, w, h) {
  const canvas = document.getElementById(canvasId);
  if (canvas) {
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').putImageData(data, 0, 0);
  }
}

/* ================================================================
   POIN 3.1 — GRAYSCALE
   Formula: gray = 0.299*R + 0.587*G + 0.114*B
================================================================ */
function computeGrayscale() {
  const src = imgData.data;
  const out = new ImageData(imgW, imgH);
  const d = out.data;

  for (let i = 0; i < src.length; i += 4) {
    const g = Math.round(0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = g;
    d[i + 3] = 255;
  }

  grayData = out;
  renderImageDataToCanvas('canvas-gray', out, imgW, imgH);
}

/* ================================================================
   TAMBAHAN: FITUR NORMALISASI (EKUALISASI) HISTOGRAM MANUAL
================================================================ */
function computeNormalization() {
  if (!grayData) return;

  const src = grayData.data;
  const out = new ImageData(imgW, imgH);
  const d = out.data;
  const totalPixels = imgW * imgH;

  // Langkah 1: Hitung histogram frekuensi keabuan
  let hist = new Array(256).fill(0);
  for (let i = 0; i < src.length; i += 4) {
    hist[src[i]]++;
  }

  // Langkah 2: Hitung nilai Kumulatif Distribusi (CDF)
  let cdf = new Array(256).fill(0);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) {
    cdf[i] = cdf[i - 1] + hist[i];
  }

  // Langkah 3: Cari CDF minimum yang bernilai lebih besar dari 0
  let cdfMin = 0;
  for (let i = 0; i < 256; i++) {
    if (cdf[i] > 0) {
      cdfMin = cdf[i];
      break;
    }
  }

  // Langkah 4: Buat Lookup Table (LUT) pemetaan intensitas baru
  let lut = new Array(256).fill(0);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(((cdf[i] - cdfMin) / (totalPixels - cdfMin)) * 255);
    lut[i] = clamp(lut[i]);
  }

  // Langkah 5: Petakan kembali seluruh piksel gambar menggunakan tabel LUT
  for (let i = 0; i < src.length; i += 4) {
    const newGray = lut[src[i]];
    d[i] = d[i + 1] = d[i + 2] = newGray;
    d[i + 3] = 255;
  }

  normData = out;
  // Memproyeksikan hasil ke canvas-normalize yang akan Anda buat di HTML
  renderImageDataToCanvas('canvas-normalize', out, imgW, imgH);
}

/* ================================================================
   FITUR NORMALISASI GAMBAR (MIN-MAX IMAGE NORMALIZATION)
   Berbeda dari ekualisasi histogram — ini meregangkan rentang
   intensitas piksel dari [min, max] asli → [0, 255]
================================================================ */

/**
 * Mengganti mode normalisasi (grayscale atau RGB per-channel)
 * dan menjalankan ulang kalkulasi normalisasi.
 */
function setNormMode(mode) {
  currentNormMode = mode;

  document.getElementById('norm-btn-gray').classList.toggle('active', mode === 'gray');
  document.getElementById('norm-btn-rgb').classList.toggle('active', mode === 'rgb');

  document.getElementById('norm-formula-gray').classList.toggle('active', mode === 'gray');
  document.getElementById('norm-formula-gray').classList.toggle('hidden', mode !== 'gray');
  document.getElementById('norm-formula-rgb').classList.toggle('active', mode === 'rgb');
  document.getElementById('norm-formula-rgb').classList.toggle('hidden', mode !== 'rgb');

  buildImageNormalization();
}

/**
 * Fungsi utama normalisasi gambar.
 * Mode 'gray': normalisasi pada citra grayscale.
 * Mode 'rgb' : normalisasi setiap channel R, G, B secara independen.
 */
function buildImageNormalization() {
  if (!imgData || !grayData) return;

  let beforeData, afterData;
  let beforeValues, afterValues;

  if (currentNormMode === 'gray') {
    // ── Mode Grayscale ──────────────────────────────────────────
    // Ambil nilai grayscale semua piksel
    const gs = grayData.data;
    const vals = [];
    for (let i = 0; i < gs.length; i += 4) vals.push(gs[i]);

    const gMin = Math.min(...vals);
    const gMax = Math.max(...vals);
    const range = gMax - gMin;

    // Buat ImageData before (grayscale asli)
    beforeData = new ImageData(imgW, imgH);
    for (let i = 0; i < gs.length; i += 4) {
      beforeData.data[i] = beforeData.data[i + 1] = beforeData.data[i + 2] = gs[i];
      beforeData.data[i + 3] = 255;
    }

    // Buat ImageData after (normalisasi min-max)
    afterData = new ImageData(imgW, imgH);
    for (let i = 0; i < gs.length; i += 4) {
      const normalized = range === 0 ? 0 : Math.round(((gs[i] - gMin) / range) * 255);
      afterData.data[i] = afterData.data[i + 1] = afterData.data[i + 2] = normalized;
      afterData.data[i + 3] = 255;
    }

    beforeValues = vals;
    afterValues = [];
    const ad = afterData.data;
    for (let i = 0; i < ad.length; i += 4) afterValues.push(ad[i]);

  } else {
    // ── Mode RGB Per-Channel ────────────────────────────────────
    const src = imgData.data;
    const rVals = [], gVals = [], bVals = [];
    for (let i = 0; i < src.length; i += 4) {
      rVals.push(src[i]);
      gVals.push(src[i + 1]);
      bVals.push(src[i + 2]);
    }

    const rMin = Math.min(...rVals), rMax = Math.max(...rVals), rRange = rMax - rMin;
    const gMin = Math.min(...gVals), gMax = Math.max(...gVals), gRange = gMax - gMin;
    const bMin = Math.min(...bVals), bMax = Math.max(...bVals), bRange = bMax - bMin;

    // Before = gambar asli (RGB)
    beforeData = new ImageData(imgW, imgH);
    for (let i = 0; i < src.length; i++) beforeData.data[i] = src[i];

    // After = normalisasi per channel
    afterData = new ImageData(imgW, imgH);
    for (let i = 0; i < src.length; i += 4) {
      afterData.data[i] = rRange === 0 ? 0 : Math.round(((src[i] - rMin) / rRange) * 255);
      afterData.data[i + 1] = gRange === 0 ? 0 : Math.round(((src[i + 1] - gMin) / gRange) * 255);
      afterData.data[i + 2] = bRange === 0 ? 0 : Math.round(((src[i + 2] - bMin) / bRange) * 255);
      afterData.data[i + 3] = 255;
    }

    // Hitung brightness (luminance) untuk statistik
    beforeValues = [];
    afterValues = [];
    for (let i = 0; i < src.length; i += 4) {
      beforeValues.push(Math.round(0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]));
    }
    const ad = afterData.data;
    for (let i = 0; i < ad.length; i += 4) {
      afterValues.push(Math.round(0.299 * ad[i] + 0.587 * ad[i + 1] + 0.114 * ad[i + 2]));
    }
  }

  // Render gambar ke canvas
  renderImageDataToCanvas('canvas-norm-before', beforeData, imgW, imgH);
  renderImageDataToCanvas('canvas-norm-after', afterData, imgW, imgH);

  // Hitung dan tampilkan statistik
  displayNormStats(beforeValues, afterValues);

  // Render histogram perbandingan
  buildNormHistograms(beforeValues, afterValues);
}

/** Hitung statistik array nilai piksel dan tampilkan ke tabel */
function displayNormStats(beforeVals, afterVals) {
  const calc = (vals) => {
    const n = vals.length;
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    return { min: mn, max: mx, mean: mean.toFixed(2), std: std.toFixed(2), range: mx - mn };
  };

  const b = calc(beforeVals);
  const a = calc(afterVals);

  document.getElementById('stat-before-min').textContent = b.min;
  document.getElementById('stat-before-max').textContent = b.max;
  document.getElementById('stat-before-mean').textContent = b.mean;
  document.getElementById('stat-before-std').textContent = b.std;
  document.getElementById('stat-before-range').textContent = b.range;

  document.getElementById('stat-after-min').textContent = a.min;
  document.getElementById('stat-after-max').textContent = a.max;
  document.getElementById('stat-after-mean').textContent = a.mean;
  document.getElementById('stat-after-std').textContent = a.std;
  document.getElementById('stat-after-range').textContent = a.range;
}

/** Buat histogram Chart.js: sebelum & sesudah normalisasi */
function buildNormHistograms(beforeVals, afterVals) {
  const makeHist = (vals) => {
    const h = new Array(256).fill(0);
    vals.forEach(v => h[clamp(v)]++);
    return h;
  };

  const labels = Array.from({ length: 256 }, (_, i) => i);
  const histBefore = makeHist(beforeVals);
  const histAfter = makeHist(afterVals);

  const baseCfg = (data, color, bgColor) => ({
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Frekuensi',
        data,
        backgroundColor: bgColor,
        borderColor: color,
        borderWidth: 0,
        barPercentage: 1,
        categoryPercentage: 1
      }]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      elements: { point: { radius: 0 } },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#64748b', maxTicksLimit: 10, font: { family: 'JetBrains Mono', size: 9 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 9 } }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });

  if (chartNormBefore) chartNormBefore.destroy();
  if (chartNormAfter) chartNormAfter.destroy();

  chartNormBefore = new Chart(
    document.getElementById('chart-norm-before'),
    baseCfg(histBefore, 'rgba(148,163,184,0.8)', 'rgba(148,163,184,0.25)')
  );
  chartNormAfter = new Chart(
    document.getElementById('chart-norm-after'),
    baseCfg(histAfter, 'rgba(16,185,129,0.8)', 'rgba(16,185,129,0.2)')
  );
}

/* ================================================================
   POIN 3.2 — CITRA BINER (THRESHOLDING)
================================================================ */
const sliderThreshold = document.getElementById('slider-threshold');
if (sliderThreshold) sliderThreshold.addEventListener('input', renderBinary);

function renderBinary() {
  if (!grayData) return;

  const t = +sliderThreshold.value;
  document.getElementById('val-threshold').textContent = t;
  document.getElementById('lbl-threshold').textContent = t;
  syncSliderGradient(sliderThreshold);

  const src = grayData.data;
  const out = new ImageData(imgW, imgH);
  const d = out.data;

  for (let i = 0; i < src.length; i += 4) {
    const v = src[i] > t ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }

  renderImageDataToCanvas('canvas-binary', out, imgW, imgH);
}

/* ================================================================
   OTSU THRESHOLDING
   Mencari threshold optimal dengan memaksimalkan varian antar-kelas
   (between-class variance): σ²_B = w_B · w_F · (μ_B − μ_F)²
================================================================ */

/**
 * Menghitung threshold optimal metode Otsu.
 * @returns {{ threshold: number, maxVariance: number }}
 */
function computeOtsuThreshold() {
  if (!grayData) return { threshold: 127, maxVariance: 0 };

  const src = grayData.data;
  const totalPixels = imgW * imgH;

  // Langkah 1: Histogram grayscale
  const hist = new Array(256).fill(0);
  for (let i = 0; i < src.length; i += 4) hist[src[i]]++;

  // Langkah 2: Jumlah total intensitas semua piksel
  let totalSum = 0;
  for (let i = 0; i < 256; i++) totalSum += i * hist[i];

  let sumBg = 0;   // akumulasi intensitas kelas background
  let wBg = 0;   // bobot (jumlah piksel) kelas background
  let maxVar = 0;
  let bestT = 0;

  // Langkah 3: Iterasi tiap calon threshold t = 0..255
  for (let t = 0; t < 256; t++) {
    wBg += hist[t];
    if (wBg === 0) continue;

    const wFg = totalPixels - wBg;
    if (wFg === 0) break;

    sumBg += t * hist[t];

    const meanBg = sumBg / wBg;
    const meanFg = (totalSum - sumBg) / wFg;
    const diff = meanBg - meanFg;

    // σ²_B = w_B · w_F · (μ_B − μ_F)²
    const varBetween = wBg * wFg * diff * diff;

    if (varBetween > maxVar) {
      maxVar = varBetween;
      bestT = t;
    }
  }

  return { threshold: bestT, maxVariance: maxVar };
}

/**
 * Render citra biner menggunakan threshold Otsu (otomatis).
 */
function renderBinaryOtsu() {
  if (!grayData) return;

  const { threshold, maxVariance } = computeOtsuThreshold();

  // Update UI info
  const elT = document.getElementById('otsu-threshold-display');
  const elVar = document.getElementById('otsu-variance-display');
  const elLbl = document.getElementById('lbl-otsu-threshold');
  if (elT) elT.textContent = threshold;
  if (elVar) elVar.textContent = maxVariance.toFixed(2);
  if (elLbl) elLbl.textContent = threshold;

  const src = grayData.data;
  const out = new ImageData(imgW, imgH);
  const d = out.data;

  for (let i = 0; i < src.length; i += 4) {
    const v = src[i] > threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }

  renderImageDataToCanvas('canvas-binary-otsu', out, imgW, imgH);
}

/* ================================================================
   POIN 3.3 — OPERASI ARITMATIKA 
================================================================ */
const sliderBrightness = document.getElementById('slider-brightness');
if (sliderBrightness) sliderBrightness.addEventListener('input', renderBrightness);

function renderBrightness() {
  if (!imgData) return;

  const beta = +sliderBrightness.value;
  const sign = beta >= 0 ? '+' : '';
  document.getElementById('val-brightness').textContent = sign + beta;
  const lblB = document.getElementById('lbl-brightness');
  if (lblB) lblB.textContent = sign + beta;
  syncSliderGradient(sliderBrightness);

  const src = imgData.data;
  const out = new ImageData(imgW, imgH);
  const d = out.data;

  for (let i = 0; i < src.length; i += 4) {
    d[i] = clamp(src[i] + beta);
    d[i + 1] = clamp(src[i + 1] + beta);
    d[i + 2] = clamp(src[i + 2] + beta);
    d[i + 3] = 255;
  }

  renderImageDataToCanvas('canvas-arith', out, imgW, imgH);
}


const sliderContrast = document.getElementById('slider-contrast');
if (sliderContrast) sliderContrast.addEventListener('input', renderContrast);

function renderContrast() {
  if (!imgData) return;

  const c = +sliderContrast.value;
  const sign = c > 0 ? '+' : '';
  document.getElementById('val-contrast').textContent = sign + c;
  const lblC = document.getElementById('lbl-contrast');
  if (lblC) lblC.textContent = sign + c;
  syncSliderGradient(sliderContrast);

  const src = imgData.data;
  const out = new ImageData(imgW, imgH);
  const d = out.data;

  // Formula Kontras: Mengonversi skala -100 s/d 100 menjadi faktor pengali
  // Menggunakan algoritma rasio kontras standar (259)
  const C = c * 2.55; 
  const F = (259 * (C + 255)) / (255 * (259 - C));

  for (let i = 0; i < src.length; i += 4) {
    d[i]     = clamp(F * (src[i] - 128) + 128);
    d[i + 1] = clamp(F * (src[i + 1] - 128) + 128);
    d[i + 2] = clamp(F * (src[i + 2] - 128) + 128);
    d[i + 3] = 255;
  }

  renderImageDataToCanvas('canvas-contrast', out, imgW, imgH);
}

/* ================================================================
   POIN 3.4 — OPERASI LOGIKA
================================================================ */
const sliderBitand = document.getElementById('slider-bitand');
if (sliderBitand) sliderBitand.addEventListener('input', renderBitand);

function renderBitand() {
  if (!imgData) return;

  const mask = +sliderBitand.value;
  document.getElementById('val-bitand').textContent = mask;
  syncSliderGradient(sliderBitand);

  const src = imgData.data;
  const out = new ImageData(imgW, imgH);
  const d = out.data;

  for (let i = 0; i < src.length; i += 4) {
    d[i] = src[i] & mask;
    d[i + 1] = src[i + 1] & mask;
    d[i + 2] = src[i + 2] & mask;
    d[i + 3] = 255;
  }

  renderImageDataToCanvas('canvas-bitand', out, imgW, imgH);
}

function renderNot() {
  if (!imgData) return;

  const src = imgData.data;
  const out = new ImageData(imgW, imgH);
  const d = out.data;

  for (let i = 0; i < src.length; i += 4) {
    d[i] = 255 - src[i];
    d[i + 1] = 255 - src[i + 1];
    d[i + 2] = 255 - src[i + 2];
    d[i + 3] = 255;
  }

  renderImageDataToCanvas('canvas-not', out, imgW, imgH);
}

/* ================================================================
   OPTIONAL 1 — HISTOGRAM (TERMASUK HISTOGRAM NORMALISASI)
================================================================ */
function buildHistograms() {
  if (!imgData || !grayData || !normData) return;

  // Hitung histogram RGB
  const rHist = new Array(256).fill(0);
  const gHist = new Array(256).fill(0);
  const bHist = new Array(256).fill(0);
  const src = imgData.data;

  for (let i = 0; i < src.length; i += 4) {
    rHist[src[i]]++;
    gHist[src[i + 1]]++;
    bHist[src[i + 2]]++;
  }

  // Hitung histogram Grayscale
  const grHist = new Array(256).fill(0);
  const gs = grayData.data;
  for (let i = 0; i < gs.length; i += 4) grHist[gs[i]]++;

  // Hitung histogram HSV Value (kecerahan)
  const vHist = new Array(256).fill(0);
  for (let i = 0; i < src.length; i += 4) {
    const v = rgbToHSV(src[i], src[i + 1], src[i + 2]).v;
    vHist[Math.round(v * 255)]++;
  }

  // TAMBAHAN: Hitung histogram dari data hasil Ekualisasi (Normalisasi)
  const nHist = new Array(256).fill(0);
  const ns = normData.data;
  for (let i = 0; i < ns.length; i += 4) nHist[ns[i]]++;

  const labels = Array.from({ length: 256 }, (_, i) => i);

  // Konfigurasi umum Chart.js
  const chartCfg = (datasets) => ({
    type: 'line',
    data: { labels, datasets },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      elements: { point: { radius: 0 }, line: { tension: 0.1 } },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#64748b', maxTicksLimit: 16, font: { family: 'JetBrains Mono', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 } }
        }
      },
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } } }
      }
    }
  });

  // Hancurkan chart lama sebelum buat baru (mencegah memory leak)
  if (chartRGB) chartRGB.destroy();
  if (chartGray) chartGray.destroy();
  if (chartHSV) chartHSV.destroy();
  if (chartNorm) chartNorm.destroy(); // TAMBAHAN

  chartRGB = new Chart(document.getElementById('chart-rgb'), chartCfg([
    { label: 'Red', data: rHist, borderColor: '#f87171', borderWidth: 1.5, fill: false },
    { label: 'Green', data: gHist, borderColor: '#4ade80', borderWidth: 1.5, fill: false },
    { label: 'Blue', data: bHist, borderColor: '#60a5fa', borderWidth: 1.5, fill: false },
  ]));

  chartGray = new Chart(document.getElementById('chart-gray'), chartCfg([
    {
      label: 'Grayscale',
      data: grHist,
      borderColor: '#e2e8f0',
      borderWidth: 2,
      fill: true,
      backgroundColor: 'rgba(226,232,240,0.08)'
    }
  ]));

  chartHSV = new Chart(document.getElementById('chart-hsv'), chartCfg([
    {
      label: 'Value (Kecerahan/HSV)',
      data: vHist,
      borderColor: '#c084fc',
      borderWidth: 2,
      fill: true,
      backgroundColor: 'rgba(192,132,252,0.08)'
    }
  ]));

}

/* ================================================================
   OPTIONAL 2 — KONVOLUSI / FILTERING
================================================================ */
const KERNELS = [
  {
    name: 'Mean (Blur)',
    emoji: '💧',
    kernel: [
      [1 / 9, 1 / 9, 1 / 9],
      [1 / 9, 1 / 9, 1 / 9],
      [1 / 9, 1 / 9, 1 / 9]
    ]
  },
  {
    name: 'Sharpening Standar',
    emoji: '🔪',
    kernel: [
      [0, -1, 0],
      [-1, 5, -1],
      [0, -1, 0]
    ]
  },
  {
    name: 'Sharpening Extreme',
    emoji: '⚡',
    kernel: [
      [-1, -1, -1],
      [-1, 9, -1],
      [-1, -1, -1]
    ]
  },
  {
    name: 'Edge Vertikal',
    emoji: '↕️',
    kernel: [
      [-1, 0, 1],
      [-2, 0, 2],
      [-1, 0, 1]
    ]
  },
  {
    name: 'Edge Horizontal',
    emoji: '↔️',
    kernel: [
      [-1, -2, -1],
      [0, 0, 0],
      [1, 2, 1]
    ]
  }
];

function buildConvolutions() {
  if (!imgData) return;

  const grid = document.getElementById('conv-grid');
  grid.innerHTML = '';

  KERNELS.forEach((kDef, idx) => {
    const result = applyConvolution(imgData, kDef.kernel, imgW, imgH);
    const canvasId = `canvas-conv-${idx}`;
    const dlName = `konvolusi-${kDef.name.toLowerCase().replace(/\s+/g, '-')}`;

    const item = document.createElement('div');
    item.className = 'conv-item';
    item.innerHTML = `
      <div class="conv-item-header">
        <h4>${kDef.emoji} ${kDef.name}</h4>
        ${buildKernelHTML(kDef.kernel)}
      </div>
      <canvas id="${canvasId}"></canvas>
      <div class="download-bar">
        <button class="download-btn" onclick="downloadCanvas('${canvasId}', '${dlName}')" id="btn-dl-conv-${idx}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Unduh PNG</span>
        </button>
      </div>
    `;
    grid.appendChild(item);

    requestAnimationFrame(() => {
      const canvas = document.getElementById(canvasId);
      if (canvas) {
        canvas.width = imgW;
        canvas.height = imgH;
        canvas.getContext('2d').putImageData(result, 0, 0);
      }
    });
  });
}

function buildKernelHTML(k) {
  let html = `<div class="kernel-display" style="grid-template-columns:repeat(${k[0].length},36px)">`;

  k.forEach(row => row.forEach(v => {
    const disp = Number.isInteger(v)
      ? v
      : (Math.abs(v) < 0.1 ? '1/' + Math.round(1 / Math.abs(v)) : v.toFixed(2));
    const cls = v > 0 ? 'positive' : v < 0 ? 'negative' : 'zero';
    html += `<div class="kernel-cell ${cls}">${disp}</div>`;
  }));

  html += '</div>';
  return html;
}

function applyConvolution(imageData, kernel, w, h) {
  const src = imageData.data;
  const out = new ImageData(w, h);
  const d = out.data;
  const kH = kernel.length;
  const kW = kernel[0].length;
  const kHH = Math.floor(kH / 2);
  const kHW = Math.floor(kW / 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rSum = 0, gSum = 0, bSum = 0;

      for (let ky = 0; ky < kH; ky++) {
        for (let kx = 0; kx < kW; kx++) {
          const sy = clampCoord(y + ky - kHH, h);
          const sx = clampCoord(x + kx - kHW, w);
          const idx = (sy * w + sx) * 4;
          const kv = kernel[ky][kx];
          rSum += src[idx] * kv;
          gSum += src[idx + 1] * kv;
          bSum += src[idx + 2] * kv;
        }
      }

      const idx = (y * w + x) * 4;
      d[idx] = clamp(Math.round(rSum));
      d[idx + 1] = clamp(Math.round(gSum));
      d[idx + 2] = clamp(Math.round(bSum));
      d[idx + 3] = 255;
    }
  }

  return out;
}

/* ================================================================
   OPTIONAL 3 — OPERASI MORFOLOGI
================================================================ */
const MORPH_KERNELS = [
  {
    name: 'Kernel Kotak (3×3)',
    emoji: '⬜',
    k: [[1, 1, 1], [1, 1, 1], [1, 1, 1]]
  },
  {
    name: 'Kernel Plus (+)',
    emoji: '➕',
    k: [[0, 1, 0], [1, 1, 1], [0, 1, 0]]
  },
  {
    name: 'Kernel Cross (×)',
    emoji: '✖️',
    k: [[1, 0, 1], [0, 1, 0], [1, 0, 1]]
  },
  {
    name: 'Kernel Horizontal (—)',
    emoji: '↔️',
    k: [[0, 0, 0], [1, 1, 1], [0, 0, 0]]
  },
  {
    name: 'Kernel Vertikal (|)',
    emoji: '↕️',
    k: [[0, 1, 0], [0, 1, 0], [0, 1, 0]]
  },
  {
    name: 'Kernel Diagonal Kanan (\\)',
    emoji: '↗️',
    k: [[0, 0, 1], [0, 1, 0], [1, 0, 0]]
  },
  {
    name: 'Kernel Diagonal Kiri (/)',
    emoji: '↖️',
    k: [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  }
];

function buildMorphology() {
  if (!imgData) return;

  const container = document.getElementById('morph-sections');
  container.innerHTML = '';

  MORPH_KERNELS.forEach((kDef, idx) => {
    const eroded = applyMorphology(imgData, kDef.k, imgW, imgH, 'erode');
    const dilated = applyMorphology(imgData, kDef.k, imgW, imgH, 'dilate');
    const erosionId = `canvas-erode-${idx}`;
    const dilationId = `canvas-dilate-${idx}`;
    const dlErodeName = `morfologi-erosi-${kDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const dlDilateName = `morfologi-dilasi-${kDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const sec = document.createElement('div');
    sec.className = 'morph-section';
    sec.innerHTML = `
      <div class="morph-section-title">
        <span>${kDef.emoji}</span>
        <span>${kDef.name}</span>
        ${buildKernelHTML(kDef.k)}
      </div>
      <div class="morph-grid">
        <div class="canvas-item">
          <div class="canvas-label"><span class="dot"></span>Erosi (Erosion)</div>
          <canvas id="${erosionId}"></canvas>
          <div class="download-bar">
            <button class="download-btn" onclick="downloadCanvas('${erosionId}', '${dlErodeName}')" id="btn-dl-erode-${idx}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Unduh PNG</span>
            </button>
          </div>
        </div>
        <div class="canvas-item">
          <div class="canvas-label"><span class="dot"></span>Dilasi (Dilation)</div>
          <canvas id="${dilationId}"></canvas>
          <div class="download-bar">
            <button class="download-btn" onclick="downloadCanvas('${dilationId}', '${dlDilateName}')" id="btn-dl-dilate-${idx}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Unduh PNG</span>
            </button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(sec);

    requestAnimationFrame(() => {
      [[erosionId, eroded], [dilationId, dilated]].forEach(([id, data]) => {
        const c = document.getElementById(id);
        if (c) {
          c.width = imgW;
          c.height = imgH;
          c.getContext('2d').putImageData(data, 0, 0);
        }
      });
    });
  });
}

function applyMorphology(imageData, kernel, w, h, op) {
  const src = imageData.data;
  const out = new ImageData(w, h);
  const d = out.data;
  const kH = kernel.length;
  const kW = kernel[0].length;
  const kHH = Math.floor(kH / 2);
  const kHW = Math.floor(kW / 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rAcc = op === 'erode' ? 255 : 0;
      let gAcc = op === 'erode' ? 255 : 0;
      let bAcc = op === 'erode' ? 255 : 0;

      for (let ky = 0; ky < kH; ky++) {
        for (let kx = 0; kx < kW; kx++) {
          if (!kernel[ky][kx]) continue;
          const sy = clampCoord(y + ky - kHH, h);
          const sx = clampCoord(x + kx - kHW, w);
          const idx = (sy * w + sx) * 4;

          if (op === 'erode') {
            rAcc = Math.min(rAcc, src[idx]);
            gAcc = Math.min(gAcc, src[idx + 1]);
            bAcc = Math.min(bAcc, src[idx + 2]);
          } else {
            rAcc = Math.max(rAcc, src[idx]);
            gAcc = Math.max(gAcc, src[idx + 1]);
            bAcc = Math.max(bAcc, src[idx + 2]);
          }
        }
      }

      const idx = (y * w + x) * 4;
      d[idx] = rAcc;
      d[idx + 1] = gAcc;
      d[idx + 2] = bAcc;
      d[idx + 3] = 255;
    }
  }

  return out;
}

/* ================================================================
   HISTOGRAM TABS — Navigasi tab antar jenis histogram
================================================================ */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const parent = btn.closest('.section-card');
    parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    parent.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

/* ================================================================
   UTILITY FUNCTIONS
================================================================ */

/**
 * Unduh canvas sebagai file PNG.
 * @param {string} canvasId - ID elemen canvas
 * @param {string} baseName - Nama file tanpa ekstensi
 */
function downloadCanvas(canvasId, baseName) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const link = document.createElement('a');
  link.download = `${baseName}_${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();

  showToast(`✅ "${baseName}.png" berhasil diunduh!`);
}

/** Tampilkan toast notifikasi selama 2.5 detik */
let _toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('dl-toast');
  const msgEl = document.getElementById('dl-toast-msg');
  if (!toast) return;
  if (msgEl) msgEl.textContent = msg;
  toast.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function clamp(v) {
  return Math.max(0, Math.min(255, v));
}

function clampCoord(v, max) {
  return Math.max(0, Math.min(max - 1, v));
}

function rgbToHSV(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return { h, s, v };
}

/* ================================================================
   DOWNLOAD ALL — Kumpulkan & ZIP semua canvas hasil konversi
================================================================ */

/**
 * Daftar semua canvas yang akan disertakan dalam ZIP.
 * Canvas dinamis (konvolusi/morfologi) di-resolve secara runtime
 * berdasarkan elemen yang ada di DOM saat tombol diklik.
 */
function getAllCanvasEntries() {
  // Canvas statis yang selalu ada setelah upload
  const STATIC = [
    { id: 'canvas-original', name: '01-original' },
    { id: 'canvas-gray', name: '02-grayscale' },
    { id: 'canvas-binary', name: '03-binary-manual' },
    { id: 'canvas-binary-otsu', name: '03-binary-otsu' },
    { id: 'canvas-arith', name: '04-brightness-adjusted' },
    { id: 'canvas-contrast', name: '04-contrast-adjusted' },
    { id: 'canvas-bitand', name: '05-bitwise-and' },
    { id: 'canvas-not', name: '06-negative-not' },
    { id: 'canvas-norm-before', name: '08-normalization-before' },
    { id: 'canvas-norm-after', name: '09-normalization-after' },
  ];

  const entries = [];

  // Tambahkan canvas statis (hanya yang tersedia)
  STATIC.forEach(e => {
    const el = document.getElementById(e.id);
    if (el && el.width > 0) entries.push(e);
  });

  // Konvolusi dinamis (canvas-conv-0 dst.)
  KERNELS.forEach((k, idx) => {
    const id = `canvas-conv-${idx}`;
    const el = document.getElementById(id);
    if (el && el.width > 0) {
      const slug = k.name.toLowerCase().replace(/\s+/g, '-');
      entries.push({ id, name: `10-konvolusi-${idx + 1}-${slug}` });
    }
  });

  // Morfologi dinamis (canvas-erode-x, canvas-dilate-x)
  MORPH_KERNELS.forEach((k, idx) => {
    const erodeId = `canvas-erode-${idx}`;
    const dilateId = `canvas-dilate-${idx}`;
    const slug = k.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const eEl = document.getElementById(erodeId);
    const dEl = document.getElementById(dilateId);
    if (eEl && eEl.width > 0) entries.push({ id: erodeId, name: `11-erosi-${idx + 1}-${slug}` });
    if (dEl && dEl.width > 0) entries.push({ id: dilateId, name: `11-dilasi-${idx + 1}-${slug}` });
  });

  return entries;
}

/** Update panel Download All: hitung file, tampilkan chip, aktifkan tombol */
function updateDownloadAllPanel() {
  const entries = getAllCanvasEntries();
  const countEl = document.getElementById('dl-all-count');
  const listEl = document.getElementById('dl-all-list');
  const btnEl = document.getElementById('btn-download-all');
  const btnTxt = document.getElementById('dl-all-btn-text');

  if (!countEl) return;

  countEl.textContent = entries.length;

  // Render chip untuk setiap file
  if (listEl) {
    listEl.innerHTML = entries.map(e =>
      `<span class="dl-file-chip ready">✓ ${e.name}.png</span>`
    ).join('');
  }

  // Aktifkan tombol jika ada gambar
  if (btnEl) {
    btnEl.disabled = entries.length === 0;
    if (btnTxt) btnTxt.textContent = entries.length > 0
      ? `Unduh Semua (${entries.length} gambar) sebagai ZIP`
      : 'Upload gambar terlebih dahulu';
  }
}

/** Kemas semua canvas ke dalam satu file ZIP lalu unduh */
async function downloadAllImages() {
  if (typeof JSZip === 'undefined') {
    showToast('⚠️ JSZip belum siap, coba lagi sebentar.');
    return;
  }

  const entries = getAllCanvasEntries();
  if (entries.length === 0) return;

  const btn = document.getElementById('btn-download-all');
  const btnTxt = document.getElementById('dl-all-btn-text');
  const progWrap = document.getElementById('dl-all-progress-wrap');
  const progBar = document.getElementById('dl-progress-bar');
  const chipsList = document.querySelectorAll('.dl-file-chip');

  // — State: Packing —
  btn.disabled = true;
  btn.classList.add('packing');
  if (btnTxt) btnTxt.textContent = `⏳ Mengemas ${entries.length} gambar...`;
  if (progWrap) progWrap.classList.add('visible');
  if (progBar) progBar.style.width = '0%';

  // Reset chip style
  chipsList.forEach(c => c.classList.remove('ready'));

  const zip = new JSZip();
  const folder = zip.folder('hasil-pengolahan-citra');
  const ts = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < entries.length; i++) {
    const { id, name } = entries[i];
    const canvas = document.getElementById(id);
    if (!canvas) continue;

    // Ambil blob PNG
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    folder.file(`${name}.png`, base64, { base64: true });

    // Update progres
    const pct = Math.round(((i + 1) / entries.length) * 100);
    if (progBar) progBar.style.width = pct + '%';

    // Light chip satu per satu
    const chip = document.querySelectorAll('.dl-file-chip')[i];
    if (chip) chip.classList.add('ready');

    // Beri jeda ringan agar UI tidak freeze
    await new Promise(r => setTimeout(r, 12));
  }

  // Generate ZIP blob & trigger download
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pengolahan-citra_${ts}.zip`;
  link.click();
  URL.revokeObjectURL(url);

  // — State: Done —
  btn.classList.remove('packing');
  btn.classList.add('done');
  if (btnTxt) btnTxt.textContent = `✅ ZIP berhasil diunduh!`;
  showToast(`📦 ${entries.length} gambar dikemas dalam ZIP!`);

  // Reset ke state normal setelah 3 detik
  setTimeout(() => {
    btn.disabled = false;
    btn.classList.remove('done');
    if (btnTxt) btnTxt.textContent = `Unduh Semua (${entries.length} gambar) sebagai ZIP`;
    if (progWrap) progWrap.classList.remove('visible');
    if (progBar) progBar.style.width = '0%';
  }, 3000);
}