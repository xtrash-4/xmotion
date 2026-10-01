// =====================================================================
// XEDITZ STUDIO - SIMPLE CONTROLLER (Y2K CHROME EDITION)
// Menghubungkan antarmuka simpel dengan WebGL Alight Motion Engine
// Rules: Zero Emojis, No Cyan, Clean Status Messages
// =====================================================================

// WORKAROUND EKSPOR: di Chrome desktop (Windows), encoder H.264 hardware yang dipilih otomatis
// ('no-preference') bisa menerima frame tanpa pernah mengeluarkan output, sehingga loop ekspor
// engine menunggu antrean encoder selamanya (macet di frame ~11). Encoder software selalu jalan.
// Skrip ini dimuat sebelum modul engine, jadi patch ini sudah aktif saat engine memanggil configure().
(function forceSoftwareAvcEncoder() {
  if (typeof VideoEncoder === 'undefined' || /Android/i.test(navigator.userAgent)) return;
  const origConfigure = VideoEncoder.prototype.configure;
  VideoEncoder.prototype.configure = function (config) {
    if (config && /^avc1/i.test(config.codec || '') &&
        (!config.hardwareAcceleration || config.hardwareAcceleration === 'no-preference')) {
      config = Object.assign({}, config, { hardwareAcceleration: 'prefer-software' });
    }
    return origConfigure.call(this, config);
  };
})();

// WORKAROUND LAYAR HITAM PADA PRESET TERTENTU: engine tidak menggambar fillImage/fillVideo pada
// <shape> berbasis <path> (mis. preset "Pata Pata": 26 layer foto berupa path persegi tanpa s=),
// sehingga hanya teks yang muncul. Path itu hanyalah persegi di sekitar titik pusat, jadi
// dikonversi menjadi shape bawaan s=".rect" + property size (satuan proxy x2 = setengah ukuran path),
// yang digambar engine dengan benar. Path non-persegi/kurva tidak disentuh.
function fixPathRectMediaShapes(xmlText) {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return { xml: xmlText, count: 0 };
    let count = 0;
    Array.from(doc.getElementsByTagName('shape')).forEach((shape) => {
      if (shape.getAttribute('fillType') !== 'media' || shape.hasAttribute('s')) return;
      const kids = Array.from(shape.children);
      const path = kids.find((c) => c.tagName === 'path');
      if (!path) return;
      if (kids.some((c) => c.tagName === 'property' && c.getAttribute('name') === 'size')) return;
      const d = path.getAttribute('d') || '';
      if (/[^MLZ]/.test(d.replace(/[^a-zA-Z]/g, ''))) return; // ada kurva/busur: bukan persegi sederhana
      const nums = (d.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || []).map(Number);
      if (nums.length < 8 || nums.length % 2) return;
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const w = maxX - minX, h = maxY - minY;
      if (!(w > 0 && h > 0)) return;
      if (Math.abs(minX + maxX) > 0.5 || Math.abs(minY + maxY) > 0.5) return; // harus berpusat di titik asal
      const eps = 0.01;
      const onEdge = xs.every((x, i) =>
        Math.abs(x - minX) < eps || Math.abs(x - maxX) < eps || Math.abs(ys[i] - minY) < eps || Math.abs(ys[i] - maxY) < eps);
      if (!onEdge) return;
      shape.removeChild(path);
      shape.setAttribute('s', '.rect');
      const prop = doc.createElementNS(shape.namespaceURI, 'property');
      prop.setAttribute('name', 'size');
      prop.setAttribute('type', 'vec2');
      prop.setAttribute('value', `${(w / 2).toFixed(6)},${(h / 2).toFixed(6)}`);
      shape.appendChild(prop);
      count++;
    });
    if (!count) return { xml: xmlText, count: 0 };
    console.log(`[XEDITZ] ${count} shape bergambar berbasis path dikonversi ke .rect`);
    return { xml: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(doc.documentElement), count };
  } catch (err) {
    console.warn('[XEDITZ] fixPathRectMediaShapes gagal, XML dipakai apa adanya:', err);
    return { xml: xmlText, count: 0 };
  }
}

// Catat media mana yang benar-benar dipakai sebagai isi layer (fillImage/fillVideo) pada preset aktif.
// Media yang hanya jadi sumber musik (mis. file mp4 besar untuk <audio>) bukan foto/video yang bisa
// diganti pengguna, jadi tidak ditampilkan sebagai slot.
window.__amFillMedia = null;
window.__amBase = null;      // XML preset aktif (setelah perbaikan path): [{name, xml}], dasar untuk edit teks
window.__textEdits = {};     // edit teks yang dipilih pengguna: { "dokumen:urutan": {content?, hidden?} }
window.__slotPicked = {};    // slotId -> nama file yang dipilih pengguna (untuk label)
window.__slotFiles = {};     // slotId -> File yang dipilih (hanya di memori, dipasang ulang setelah reload preset)
window.__customAudio = null; // musik pilihan pengguna (hanya di memori)
function registerXmlMediaUsage(xmlTexts, names) {
  try {
    const fills = new Set();
    const base = [];
    let hasAny = false;
    [].concat(xmlTexts).forEach((text, i) => {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) return;
      hasAny = true;
      base.push({ name: (names && names[i]) || `preset${i + 1}.xml`, xml: text });
      Array.from(doc.getElementsByTagName('*')).forEach((el) => {
        ['fillImage', 'fillVideo'].forEach((a) => { const v = el.getAttribute(a); if (v) fills.add(v); });
      });
    });
    window.__amFillMedia = hasAny ? fills : null;
    window.__amBase = hasAny ? base : null;
    if (hasAny) window.__xmlLoadSeq = (window.__xmlLoadSeq || 0) + 1; // penanda: ada XML valid yang baru diterima
    // preset baru: semua perubahan pengguna sebelumnya tidak berlaku lagi
    window.__slotPicked = {};
    window.__slotFiles = {};
    window.__textEdits = {};
    window.__customAudio = null;
    if (typeof window.__onXmlRegistered === 'function') window.__onXmlRegistered();
  } catch (err) {
    window.__amFillMedia = null;
    window.__amBase = null;
  }
}

// Base API configuration (mendukung localhost, domain Render online, maupun APK Android file:///)
window.__RENDER_API_URL = 'https://xmotion-5tnu.onrender.com';
window.__API_BASE = localStorage.getItem('XPREST_API_BASE') || (location.protocol === 'file:' ? window.__RENDER_API_URL : '');

// XML dari link Alight Motion & Auto-routing API untuk APK Android
(function patchGlobalFetch() {
  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    let reqUrl = typeof input === 'string' ? input : (input && input.url) || '';
    
    // Normalisasi preset path agar selalu valid di WebView Android (file://) maupun web browser
    if (typeof reqUrl === 'string') {
      if (reqUrl.startsWith('../preset/')) {
        reqUrl = './preset/' + reqUrl.slice(10);
        input = reqUrl;
      } else if (reqUrl.includes('/android_asset/preset/')) {
        reqUrl = reqUrl.replace('/android_asset/preset/', '/android_asset/web/preset/');
        input = reqUrl;
      }
    }

    // Jika diakses dari APK Android (file://) atau API_BASE telah diset, arahkan endpoint /api/ ke server online
    if (window.__API_BASE && reqUrl.startsWith('/api/')) {
      reqUrl = window.__API_BASE.replace(/\/+$/, '') + reqUrl;
      input = (typeof input === 'string') ? reqUrl : new Request(reqUrl, input);
    }

    const res = await origFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (res.ok && url.includes('/api/project-xml')) {
        const data = await res.clone().json();
        if (data && typeof data.xml === 'string') {
          const fixed = fixPathRectMediaShapes(data.xml);
          registerXmlMediaUsage(fixed.xml, [data.xmlName]);
          if (fixed.count) {
            data.xml = fixed.xml;
            return new Response(JSON.stringify(data), {
              status: res.status,
              statusText: res.statusText,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      }
    } catch (err) { /* pakai respons asli */ }
    return res;
  };
})();

// XML yang di-upload manual: perbaiki sebelum handler engine membacanya (change dialihkan sekali).
document.addEventListener('change', async (e) => {
  const input = e.target;
  if (!input || input.id !== 'impXml' || input.__xmlFixed || !input.files || !input.files.length) return;
  e.stopImmediatePropagation();
  const out = new DataTransfer();
  const texts = [];
  for (const file of Array.from(input.files)) {
    try {
      const fixed = fixPathRectMediaShapes(await file.text());
      texts.push(fixed.xml);
      out.items.add(fixed.count ? new File([fixed.xml], file.name, { type: file.type || 'text/xml' }) : file);
    } catch (err) {
      out.items.add(file);
    }
  }
  registerXmlMediaUsage(texts, Array.from(input.files).map((f) => f.name));
  input.files = out.files;
  input.__xmlFixed = true;
  try { input.dispatchEvent(new Event('change', { bubbles: true })); } finally { input.__xmlFixed = false; }
}, true);

// Jembatan simpan untuk APK Android: WebView tidak bisa mengunduh blob: lewat <a download>,
// jadi hasil ekspor dikirim per potongan ke AndroidNative dan disimpan di Download/XEDITZ.
(function androidDownloadBridge() {
  const native = window.AndroidNative;
  if (!native || typeof native.saveBegin !== 'function') return;
  const notify = (msg) => (typeof window.__toast === 'function' ? window.__toast(msg) : console.log('[XEDITZ]', msg));
  const readBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('gagal membaca data'));
    reader.readAsDataURL(blob);
  });
  const check = (res, fallback) => {
    if (!String(res).startsWith('OK')) throw new Error(String(res).split('|')[1] || fallback);
  };
  let saving = false;
  document.addEventListener('click', async (e) => {
    const link = e.target.closest && e.target.closest('a[download]');
    if (!link || !link.href) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (saving) return;
    saving = true;
    const name = link.getAttribute('download') || 'xeditz.mp4';
    try {
      notify('Menyimpan video ke perangkat...');
      const blob = await (await fetch(link.href)).blob();
      check(native.saveBegin(name, blob.type || 'video/mp4'), 'gagal memulai penyimpanan');
      const CHUNK = 3 * 256 * 1024; // kelipatan 3 byte: base64 tiap potongan berdiri sendiri
      for (let off = 0; off < blob.size; off += CHUNK) {
        check(native.saveChunk(await readBase64(blob.slice(off, off + CHUNK))), 'gagal menulis berkas');
      }
      check(native.saveEnd(), 'gagal menyelesaikan berkas');
    } catch (err) {
      try { native.saveAbort(); } catch (ignore) { /* sudah tertutup */ }
      console.error('[XEDITZ] simpan gagal:', err);
      notify('Gagal menyimpan video: ' + err.message);
    } finally {
      saving = false;
    }
  }, true);
})();

// Helper membuat file audio WAV hening (silent audio) untuk mereset engine secara bersih
function createSilentAudioFile() {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  }
  writeString(0, 'RIFF');
  view.setUint32(4, 36, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, 44100, true);
  view.setUint32(28, 44100 * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, 0, true);
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return new File([blob], 'silence.wav', { type: 'audio/wav' });
}

// Helper membuat gambar placeholder elegan untuk slot preset yang tidak menyertakan foto di cloud
function createSlotPlaceholder(slotIndex, slotTitle) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  
  const grad = ctx.createLinearGradient(0, 0, 1080, 1920);
  grad.addColorStop(0, '#090d16');
  grad.addColorStop(0.5, '#1e1b4b');
  grad.addColorStop(1, '#090d16');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1920);

  ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
  ctx.lineWidth = 14;
  ctx.strokeRect(36, 36, 1008, 1848);

  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.font = 'bold 88px Outfit, Inter, sans-serif';
  ctx.fillText(`KLIP ${slotIndex}`, 540, 920);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '40px Inter, sans-serif';
  ctx.fillText('Ketuk "Ganti Foto" untuk memasang foto Anda', 540, 1010);

  if (slotTitle) {
    ctx.fillStyle = '#6366f1';
    ctx.font = '30px Inter, sans-serif';
    ctx.fillText(slotTitle.slice(0, 32), 540, 1080);
  }

  return new Promise(resolve => {
    canvas.toBlob(blob => {
      resolve(new File([blob], `placeholder_${slotIndex}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.88);
  });
}

// Helper standar untuk memasang audio ke engine runtime WebGL dan menyinkronkan state
async function applyEngineAudio(audioFileOrBlob, displayName) {
  const audioLabel = document.getElementById('capcutAudioLabel');

  if (!audioFileOrBlob) {
    window.__customAudio = null;
    if (audioLabel) audioLabel.textContent = '+ Pilih Lagu';
    try {
      const silent = createSilentAudioFile();
      if (window.AM && typeof window.AM.setAudio === 'function') {
        await window.AM.setAudio(silent);
        console.log('[XEDITZ Audio] Audio engine berhasil di-reset ke hening (silent).');
      }
    } catch (e) {
      console.warn('[XEDITZ Audio] Gagal mereset audio engine:', e);
    }
    return null;
  }

  window.__customAudio = audioFileOrBlob;
  const resolvedName = displayName || audioFileOrBlob.name || 'Musik Preset';

  // 1. Update UI label CapCut di header jika ada
  if (audioLabel) {
    audioLabel.textContent = resolvedName.length > 12 ? resolvedName.slice(0, 11) + '…' : resolvedName;
  }

  // 2. Hubungkan langsung ke window.AM.setAudio API engine
  if (window.AM && typeof window.AM.setAudio === 'function') {
    try {
      const res = await window.AM.setAudio(audioFileOrBlob);
      console.log('[XEDITZ Audio] Audio engine berhasil dipasang:', resolvedName, res);
      return res;
    } catch (err) {
      console.error('[XEDITZ Audio Error] Gagal memanggil window.AM.setAudio:', err);
    }
  } else {
    console.warn('[XEDITZ Audio] window.AM.setAudio belum siap atau tidak tersedia');
  }
  return null;
}
window.__applyEngineAudio = applyEngineAudio;


// Listener change tangkap jika ada file audio yang disuntikkan ke #impPhoto
document.addEventListener('change', async (e) => {
  const input = e.target;
  if (!input || input.id !== 'impPhoto' || !input.files || !input.files.length) return;
  const audio = Array.from(input.files).find((f) => /^audio\//.test(f.type) || /\.(mp3|m4a|wav|aac|ogg|mp4)$/i.test(f.name));
  if (audio) {
    await applyEngineAudio(audio);
  }
}, true);

document.addEventListener('DOMContentLoaded', () => {
  console.log('[XEDITZ Studio] Controller Initializing...');

  // 1. TAB SWITCHING & DEFAULT TO MEDIA TAB (CAPCUT BOTTOM NAV & TABS)
  const tabBtns = document.querySelectorAll('.hub-tabs .tab-btn, .capcut-bottom-nav .capcut-nav-item');
  const panes = document.querySelectorAll('.tab-content-wrapper .pane');

  function activateStudioTab(targetTab) {
    if (!targetTab || targetTab === 'proyek') targetTab = 'media';
    const allNavBtns = document.querySelectorAll('.hub-tabs .tab-btn, .capcut-bottom-nav .capcut-nav-item');
    allNavBtns.forEach(b => {
      const isActive = b.getAttribute('data-tab') === targetTab;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    panes.forEach(p => {
      p.classList.toggle('active', p.id === `pane-${targetTab}`);
    });
  }

  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest && e.target.closest('.capcut-bottom-nav .capcut-nav-item, .hub-tabs .tab-btn');
    if (navBtn) {
      const targetTab = navBtn.getAttribute('data-tab');
      if (targetTab) activateStudioTab(targetTab);
    }
    const audioBtn = e.target.closest && e.target.closest('#capcutAudioBtn');
    if (audioBtn) {
      activateStudioTab('audio');
    }
  });

  // Default awal harus selalu tab Foto & Media
  activateStudioTab('media');

  // Guard: Jika bundle runtime bawaan memicu switch ke pane-proyek via wi('proyek'), redirect ke tab 'media'
  const proyekPane = document.getElementById('pane-proyek');
  if (proyekPane) {
    const paneObserver = new MutationObserver(() => {
      if (proyekPane.classList.contains('active')) {
        proyekPane.classList.remove('active');
        activateStudioTab('media');
      }
    });
    paneObserver.observe(proyekPane, { attributes: true, attributeFilter: ['class'] });
  }

  // Backup timer saat startup untuk memastikan tab media tetap aktif setelah engine selesai inisialisasi
  setTimeout(() => activateStudioTab('media'), 250);
  setTimeout(() => activateStudioTab('media'), 600);


  // 2. FUNGSI PEMUATAN PRESET DEFAULT DI AWAL (Tanpa Perlu Klik Kartu Template)
  let autoLoadTimer = null;
  window.__cancelAutoLoad = false;

  async function loadInitialDefaultPreset() {
    if (window.__presetLoaded || window.__cancelAutoLoad) return;
    if (typeof engineHasPreset === 'function' && engineHasPreset()) {
      window.__presetLoaded = true;
      return;
    }
    const impState = document.getElementById('impState');
    if (impState) impState.textContent = 'Menyiapkan editor...';

    try {
      // Tunggu sampai WebGL engine (window.AM) selesai inisialisasi canvas
      if (window.AM && typeof window.AM.waitReady === 'function') {
        try {
          await window.AM.waitReady(10000);
        } catch (wErr) {
          console.warn('[AutoLoad] waitReady timeout/skip:', wErr);
        }
      }
      if (window.__cancelAutoLoad || (typeof engineHasPreset === 'function' && engineHasPreset())) {
        window.__presetLoaded = true;
        return;
      }

      const xmlResp = await fetch('./runtime/presets/Beraksi.xml');
      if (!xmlResp.ok || window.__cancelAutoLoad) return;
      const xmlText = await xmlResp.text();

      if (window.__cancelAutoLoad || (typeof engineHasPreset === 'function' && engineHasPreset())) {
        window.__presetLoaded = true;
        return;
      }
      const xmlFile = new File([xmlText], 'Beraksi.xml', { type: 'text/xml' });
      const dt = new DataTransfer();
      dt.items.add(xmlFile);

      const impXml = document.getElementById('impXml');
      if (impXml && !window.__cancelAutoLoad) {
        impXml.files = dt.files;
        impXml.dispatchEvent(new Event('change', { bubbles: true }));
      }

      setTimeout(async () => {
        if (window.__cancelAutoLoad) return;
        try {
          const audioResp = await fetch('./runtime/presets/Beraksi.mp3');
          if (audioResp.ok && !window.__cancelAutoLoad) {
            const audioBlob = await audioResp.blob();
            const audioFile = new File([audioBlob], 'Beraksi.mp3', { type: 'audio/mp4' });
            await applyEngineAudio(audioFile, 'Beraksi.mp3');
          }
        } catch (aErr) {
          console.warn('[Audio Load Warning]', aErr);
        }
      }, 400);

      window.__presetLoaded = true;
      if (impState) impState.textContent = 'Preset aktif: Beraksi.xml';
    } catch (err) {
      console.warn('[Initial preset load warn]', err);
    }
  }

  // Monitor perubahan manual input XML
  const impXml = document.getElementById('impXml');
  const impState = document.getElementById('impState');
  if (impXml) {
    impXml.addEventListener('change', () => {
      if (impXml.files && impXml.files.length > 0) {
        const fileNames = Array.from(impXml.files).map(f => f.name).join(', ');
        if (impState) impState.textContent = `Preset aktif: ${fileNames}`;
      }
    });
  }

  // 3. EKSTRAK AUDIO DARI FILE VIDEO (Upload Video -> Ambil Audionya)
  const videoAudioInput = document.getElementById('videoAudioInput');
  const videoAudioState = document.getElementById('videoAudioState');

  if (videoAudioInput) {
    videoAudioInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (videoAudioState) {
        videoAudioState.style.display = 'block';
        videoAudioState.style.color = '#cbd5e1';
        videoAudioState.textContent = `Mengekstrak audio dari video "${file.name}"...`;
      }

      try {
        // Also upload to server for ffmpeg extraction if needed
        const formData = new FormData();
        formData.append('video', file);

        const resp = await fetch('/api/extract-audio', {
          method: 'POST',
          body: formData
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data.url) {
            const audioFetch = await fetch(data.url);
            const audioBlob = await audioFetch.blob();
            const extractedFile = new File([audioBlob], data.filename || 'extracted_audio.mp3', { type: 'audio/mp3' });
            
            await applyEngineAudio(extractedFile, data.filename);

            if (videoAudioState) {
              videoAudioState.style.color = '#34d399';
              videoAudioState.textContent = `Berhasil mengekstrak audio: ${data.filename}`;
            }
            return;
          }
        }

        // Fallback: direct blob
        const fallbackAudio = new File([file], file.name.replace(/\.[^/.]+$/, "") + ".mp3", { type: 'audio/mp3' });
        await applyEngineAudio(fallbackAudio, fallbackAudio.name);

        if (videoAudioState) {
          videoAudioState.style.color = '#34d399';
          videoAudioState.textContent = 'Audio video terpasang langsung.';
        }
      } catch (err) {
        console.error('[Video Audio Extract Error]', err);
        if (videoAudioState) {
          videoAudioState.style.color = '#f87171';
          videoAudioState.textContent = `Gagal ekstrak audio: ${err.message}`;
        }
      }
    });
  }

  // 4. AMBIL LAGU DARI LINK TIKTOK
  const urlTiktok = document.getElementById('urlTiktok');
  const urlTiktokGo = document.getElementById('urlTiktokGo');
  const urlTiktokState = document.getElementById('urlTiktokState');

  if (urlTiktokGo && urlTiktok) {
    urlTiktokGo.addEventListener('click', async () => {
      const tiktokUrl = urlTiktok.value.trim();
      if (!tiktokUrl) {
        if (urlTiktokState) urlTiktokState.textContent = 'Silakan tempel link video TikTok terlebih dahulu.';
        return;
      }

      urlTiktokGo.disabled = true;
      if (urlTiktokState) {
        urlTiktokState.textContent = 'Mengambil audio dari TikTok...';
        urlTiktokState.style.color = '#cbd5e1';
      }

      try {
        const resp = await fetch(`/api/tiktok?url=${encodeURIComponent(tiktokUrl)}`);
        const data = await resp.json();

        if (!resp.ok || data.error) {
          throw new Error(data.error || 'Gagal mengambil audio TikTok.');
        }

        // Download audio and inject to engine
        if (data.url) {
          const aResp = await fetch(data.url);
          const aBlob = await aResp.blob();
          const aFile = new File([aBlob], data.filename || 'tiktok_audio.mp3', { type: 'audio/mp3' });
          
          await applyEngineAudio(aFile, data.filename);

          if (urlTiktokState) {
            urlTiktokState.style.color = '#34d399';
            urlTiktokState.textContent = `Musik TikTok berhasil dipasang: ${data.filename}`;
          }
        }
      } catch (err) {
        console.error('[TikTok Fetch Error]', err);
        if (urlTiktokState) {
          urlTiktokState.style.color = '#f87171';
          urlTiktokState.textContent = `Error: ${err.message}`;
        }
      } finally {
        urlTiktokGo.disabled = false;
      }
    });
  }

  // 5. UPLOAD FILE AUDIO LANGSUNG (MP3/M4A)
  const directAudioInput = document.getElementById('directAudioInput');
  if (directAudioInput) {
    directAudioInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await applyEngineAudio(file, file.name);
    });
  }

  // 6. PROGRESS BAR OBSERVER (Update % Text during Export)
  const expBar = document.getElementById('expBar');
  const exportProgressBox = document.getElementById('exportProgressBox');
  const expPctNum = document.getElementById('expPctNum');
  const expStart = document.getElementById('expStart');

  if (expStart) {
    expStart.addEventListener('click', () => {
      if (exportProgressBox) exportProgressBox.style.display = 'flex';
    });
  }

  if (expBar) {
    const updatePct = () => {
      const max = parseFloat(expBar.max) || 1;
      const val = parseFloat(expBar.value) || 0;
      const pct = Math.min(100, Math.round((val / max) * 100));
      if (expPctNum) expPctNum.textContent = `${pct}%`;
    };
    const observer = new MutationObserver(updatePct);
    observer.observe(expBar, { attributes: true, attributeFilter: ['value', 'max'] });
  }

  // 7. IMPOR PRESET DARI LINK ALIGHT MOTION (alightcreative.com / alight.link)
  const customUrlAmInput = document.getElementById('customUrlAmInput');
  const btnFetchAm = document.getElementById('btnFetchAm');
  const btnPasteAm = document.getElementById('btnPasteAm');
  const customUrlAmStatus = document.getElementById('customUrlAmStatus');
  const statusAmTitle = document.getElementById('statusAmTitle');
  const statusAmDesc = document.getElementById('statusAmDesc');
  const customUrlAmPick = document.getElementById('customUrlAmPick');
  const customUrlAmPickRow = document.getElementById('customUrlAmPickRow');

  const urlAm = document.getElementById('urlAm');
  const urlAmGo = document.getElementById('urlAmGo');
  const urlAmState = document.getElementById('urlAmState');
  const urlAmPick = document.getElementById('urlAmPick');

  function showAmStatus(type, title, desc) {
    if (!customUrlAmStatus) return;
    customUrlAmStatus.style.display = 'flex';
    customUrlAmStatus.className = `link-status-box ${type}`;
    if (statusAmTitle) statusAmTitle.textContent = title;
    if (statusAmDesc) statusAmDesc.textContent = desc || '';
  }

  // Tombol Paste dari Clipboard
  if (btnPasteAm && customUrlAmInput) {
    btnPasteAm.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const clipText = await navigator.clipboard.readText();
          if (clipText && (clipText.startsWith('http://') || clipText.startsWith('https://'))) {
            customUrlAmInput.value = clipText.trim();
            customUrlAmInput.focus();
            showAmStatus('success', 'Link berhasil ditempel dari clipboard.', clipText.trim());
            return;
          }
        }
      } catch (clipErr) {
        console.warn('Clipboard read error:', clipErr);
      }
      customUrlAmInput.focus();
      customUrlAmInput.select();
    });
  }

  // Handler Impor Link Alight Motion
  if (customUrlAmInput && btnFetchAm) {
    // Batalkan auto-load default jika pengguna berinteraksi dengan input link
    customUrlAmInput.addEventListener('focus', () => {
      window.__cancelAutoLoad = true;
    });
    customUrlAmInput.addEventListener('input', () => {
      if (customUrlAmInput.value.trim().length > 0) {
        window.__cancelAutoLoad = true;
      }
    });

    const doImportLink = async (selectedProject = null) => {
      // Pastikan auto-load preset default tidak berjalan lagi
      window.__cancelAutoLoad = true;
      window.__presetLoaded = true;
      if (autoLoadTimer) clearTimeout(autoLoadTimer);

      const link = (customUrlAmInput && customUrlAmInput.value ? customUrlAmInput.value.trim() : '');
      if (!link) {
        showAmStatus('error', 'Masukkan link preset terlebih dahulu.', 'Format: Alight Motion, Google Drive XML, atau direct XML URL.');
        return;
      }

      const isAm = link.includes('alightcreative.com') || link.includes('alight.link');
      const isDrive = link.includes('drive.google.com');
      const isXml = link.toLowerCase().includes('.xml');
      const isHttp = link.startsWith('http://') || link.startsWith('https://');

      if (!isHttp || (!isAm && !isDrive && !isXml)) {
        showAmStatus('error', 'Link tidak dikenali.', 'Gunakan link resmi Alight Motion, Google Drive XML, atau URL XML preset.');
        return;
      }

      btnFetchAm.disabled = true;
      showAmStatus('loading', 'Menghubungkan ke sumber preset...', 'Memeriksa paket XML dan asset media...');

      // 0. Hentikan pemutaran video lama jika sedang berjalan
      try {
        if (window.AM && typeof window.AM.getState === 'function' && window.AM.getState().isPlaying) {
          const btnPlay = document.getElementById('play');
          if (btnPlay) btnPlay.click();
        }
      } catch (pErr) { /* ignore */ }

      // 0b. WAJIB: Bersihkan audio lama sebelum impor dimulai agar tidak menjadi zombie / residu
      await applyEngineAudio(null);
      window.__customAudio = null;

      // Reset file slot dan framing preset lama
      window.__slotFiles = {};
      window.__slotPicked = {};
      window.__slotRawFiles = {};

      try {
        // 1. Sinkronkan ke input engine tersembunyi
        if (urlAm) urlAm.value = link;

        // 2. Request ke server backend lokal untuk metadata & asset info
        const query = selectedProject 
          ? `url=${encodeURIComponent(link)}&project=${encodeURIComponent(selectedProject)}` 
          : `url=${encodeURIComponent(link)}`;

        showAmStatus('loading', 'Mengambil metadata preset...', 'Menghubungi endpoint /api/project-xml...');
        const resp = await fetch(`/api/project-xml?${query}`);
        const data = await resp.json();

        if (!resp.ok || data.error) {
          throw new Error(data.error || 'Gagal mengunduh paket dari link Alight Motion.');
        }

        const projectTitle = data.meta?.title || data.xmlName || 'Alight Motion Preset';
        const mediaList = Array.isArray(data.media) ? data.media : [];
        showAmStatus('loading', `Mengunduh & mendaftarkan ${mediaList.length} media...`, `${projectTitle}`);

        // 3. Multi-proyek dalam satu paket link
        if (Array.isArray(data.projects) && data.projects.length > 1 && customUrlAmPick && customUrlAmPickRow) {
          customUrlAmPick.innerHTML = '';
          data.projects.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.title || p.name;
            if (p.name === (selectedProject || data.xmlName)) opt.selected = true;
            customUrlAmPick.appendChild(opt);
          });
          customUrlAmPickRow.style.display = 'block';
        } else if (customUrlAmPickRow) {
          customUrlAmPickRow.style.display = 'none';
        }

        // 4. Muat XML ke engine WebGL -- gunakan mekanisme yang sama
        //    dengan auto-load default (Beraksi.xml) yang terbukti berfungsi:
        //    set impXml.files lalu dispatch 'change' TANPA __xmlFixed
        //    agar interceptor baris 160 memproses file untuk engine.
        showAmStatus('loading', 'Menyusun scene ke mesin WebGL...', projectTitle);

        const finalXmlName = data.xmlName || `${(projectTitle || 'preset').replace(/[^a-zA-Z0-9._-]/g, '_')}.xml`;
        const xmlFile = new File([data.xml], finalXmlName, { type: 'text/xml' });

        const seqBefore = window.__xmlLoadSeq || 0;
        const engineImpXml = document.getElementById('impXml');
        if (engineImpXml) {
          const dt = new DataTransfer();
          dt.items.add(xmlFile);
          engineImpXml.files = dt.files;
          // Dispatch TANPA __xmlFixed agar interceptor capturing (baris 160)
          // memproses fixPathRectMediaShapes + registerXmlMediaUsage + re-dispatch
          // ke engine listener secara otomatis -- pola identik auto-load default.
          engineImpXml.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Tunggu engine selesai memuat scene (poll xmlLoadSeq + isBusy)
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const t0 = Date.now();
        let engineReady = false;
        while (Date.now() - t0 < 30000) {
          await sleep(300);
          const seqNow = window.__xmlLoadSeq || 0;
          const isBusy = !!(window.AM && window.AM.getState && window.AM.getState().isBusy);
          if (seqNow > seqBefore && !isBusy) {
            engineReady = true;
            break;
          }
        }

        // 4b. Pasang foto dan video asli bawaan preset ke media slots engine
        if (engineReady && window.AM && typeof window.AM.getMediaSlots === 'function' && typeof window.AM.applyMedia === 'function') {
          showAmStatus('loading', 'Memasang foto dan aset preset...', projectTitle);
          const currentSlots = window.AM.getMediaSlots();
          let slotIdx = 0;
          for (const slot of currentSlots) {
            slotIdx++;
            const cleanId = (slot.id || '').replace(/^amproj:/, '');
            const matched = mediaList.find(m => m.name === cleanId || m.name === slot.name || (m.name && cleanId.includes(m.name)));
            if (matched && matched.url) {
              try {
                let fetchUrl = matched.url;
                if (window.__API_BASE && fetchUrl.startsWith('/api/')) {
                  fetchUrl = window.__API_BASE.replace(/\/+$/, '') + fetchUrl;
                }
                const mResp = await fetch(fetchUrl);
                if (mResp.ok) {
                  const mBlob = await mResp.blob();
                  const isVid = (matched.mime && matched.mime.startsWith('video/')) || /\.(mp4|mov|webm)$/i.test(matched.name || '');
                  const mType = isVid ? (mBlob.type || 'video/mp4') : (mBlob.type || 'image/jpeg');
                  const mFile = new File([mBlob], matched.name || cleanId, { type: mType });
                  await window.AM.applyMedia(slot.id, mFile);
                  window.__slotFiles[slot.id] = mFile;
                  window.__slotPicked[slot.id] = matched.name || cleanId;
                }
              } catch (mErr) {
                console.warn('[Apply Preset Media Warn]', slot.id, mErr);
              }
            } else {
              // Jika preset tidak memiliki media di cloud, pasang placeholder bersih agar foto preset lama tidak tertahan!
              try {
                const placeholder = await createSlotPlaceholder(slotIdx, slot.name || cleanId);
                await window.AM.applyMedia(slot.id, placeholder);
              } catch (phErr) {
                console.warn('[Placeholder Apply Warn]', slot.id, phErr);
              }
            }
          }
        }

        // 4c. Pasang audio bawaan preset (mendukung file .mp3, .m4a, maupun track sound TikTok .mp4)
        let audioItem = data.audioItem || null;
        if (!audioItem && typeof data.xml === 'string') {
          const mAudio = data.xml.match(/<audio\s[^>]*?src=["'](?:amproj:)?([^"']+)["']/i);
          if (mAudio && mAudio[1]) {
            const rawAudio = mAudio[1].split('/').pop().replace(/^amproj:/, '');
            audioItem = mediaList.find(m => m.name === rawAudio || (m.name && m.name.endsWith(rawAudio)) || (m.name && rawAudio.includes(m.name)));
          }
        }
        if (!audioItem) {
          audioItem = mediaList.find(m => (m.mime && m.mime.startsWith('audio/')) || /\.(mp3|m4a|wav|aac|ogg)$/i.test(m.name || ''));
        }

        let audioSuccess = false;
        if (audioItem && audioItem.url) {
          try {
            let audioFetchUrl = audioItem.url;
            if (window.__API_BASE && audioFetchUrl.startsWith('/api/')) {
              audioFetchUrl = window.__API_BASE.replace(/\/+$/, '') + audioFetchUrl;
            }
            const aResp = await fetch(audioFetchUrl);
            if (aResp.ok) {
              const aBlob = await aResp.blob();
              const isVideoTrack = /\.(mp4|mov|webm)$/i.test(audioItem.name || '') || (audioItem.mime && audioItem.mime.startsWith('video/'));
              const mimeType = isVideoTrack ? (aBlob.type || 'video/mp4') : (aBlob.type || audioItem.mime || 'audio/mp3');
              const aFile = new File([aBlob], audioItem.name || 'preset_audio.mp4', { type: mimeType });
              
              // Langsung pasang ke engine WebGL lewat window.AM.setAudio
              await applyEngineAudio(aFile, audioItem.name);
              audioSuccess = true;
            }
          } catch (aErr) {
            console.warn('[Auto Audio Load Warning]', aErr);
          }
        }

        // PENTING: Jika audio tidak ada di paket cloud atau gagal dimuat,
        // PASTIKAN tetap panggil applyEngineAudio(null) agar lagu lama Beraksi.mp3 TIDAK PERNAH memutar!
        if (!audioSuccess) {
          await applyEngineAudio(null);
        }

        // 5. Selesaikan impor
        btnFetchAm.disabled = false;

        const slots = (window.AM && typeof window.AM.getMediaSlots === 'function') ? window.AM.getMediaSlots() : [];

        const hasAudio = audioSuccess;
        const audioLabel = document.getElementById('capcutAudioLabel');
        if (audioLabel) {
          audioLabel.textContent = hasAudio 
            ? (audioItem?.name ? (audioItem.name.length > 12 ? audioItem.name.slice(0, 11) + '…' : audioItem.name) : 'Musik Asli')
            : '+ Pilih Lagu';
        }

        if (typeof tidySlots === 'function') {
          tidySlots();
        } else if (typeof window.__tidySlots === 'function') {
          window.__tidySlots();
        }

        // Trigger render WebGL ke frame awal agar tampilan kanvas langsung berganti foto baru
        const seekEl = document.getElementById('seek');
        if (seekEl) {
          seekEl.value = 0;
          seekEl.dispatchEvent(new Event('input', { bubbles: true }));
          seekEl.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const slotNum = slots.length || mediaList.length;
        if (engineReady) {
          const detailMsg = hasAudio
            ? `${slotNum} klip terpasang dengan musik asli. Siap dimainkan.`
            : `Preset dimuat (${slotNum} klip). Catatan: Pembuat preset tidak mengunggah lagu ke cloud — silakan ketuk "Musik" di atas untuk memasang lagu.`;
          showAmStatus('success', `Preset "${projectTitle}" Berhasil Dimuat!`, detailMsg);
        } else {
          showAmStatus('error', 'Mesin WebGL belum selesai memuat.',
            'Preset mungkin tidak valid atau engine belum siap. Coba muat ulang halaman.');
        }
        if (impState) impState.textContent = `Preset aktif: ${projectTitle}`;


      } catch (err) {
        console.error('[Link AM Import Error]', err);
        btnFetchAm.disabled = false;
        showAmStatus('error', 'Gagal memproses link.', err.message);
      }
    };

    btnFetchAm.addEventListener('click', () => doImportLink());

    if (customUrlAmPick) {
      customUrlAmPick.addEventListener('change', () => {
        doImportLink(customUrlAmPick.value);
      });
    }
  }

  // 8. DETEKSI AKSELERASI GRAFIS & RECOVERY HANDLER (WebGL Context Protection)
  const canvas = document.getElementById('view');
  if (canvas) {
    // Tangani event context lost agar browser Chrome tidak mendisable WebGL secara permanen
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[XEDITZ WebGL] Context lost terdeteksi. Mencegah browser mendisable WebGL...');
      const sub = document.getElementById('subtitle');
      if (sub) {
        sub.innerHTML = '<span style="color:#fbbf24;">Grafis di-reset driver saat memutar video. Buka lewat start_xeditz.bat, atau set chrome://flags/#disable-accelerated-video-decode ke Disabled, lalu muat ulang.</span>';
      }
    }, false);

    canvas.addEventListener('webglcontextrestored', () => {
      console.log('[XEDITZ WebGL] Context grafis berhasil dipulihkan.');
      const sub = document.getElementById('subtitle');
      if (sub) {
        sub.textContent = 'Akselerasi Grafis (WebGL) siap.';
      }
    }, false);

    // Gunakan elemen kanvas probe terpisah (off-screen) agar TIDAK mengganggu inisialisasi context #view
    try {
      const probeCanvas = document.createElement('canvas');
      const testGl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl') || probeCanvas.getContext('experimental-webgl');
      if (!testGl) {
        console.warn('[XEDITZ] WebGL tidak aktif di browser ini.');
        const sub = document.getElementById('subtitle');
        if (sub) {
          sub.innerHTML = '<span style="color:#f87171;">Akselerasi Grafis (WebGL) belum aktif di browser. Aktifkan di chrome://settings/system.</span>';
        }
      }
    } catch(glErr) {
      console.warn('WebGL probe error:', glErr);
    }
  }

  // 8a-2. PLAYER PLAY/PAUSE LOGO SYNC & TAP-TO-PLAY (LOGO PLAY OTOMATIS HILANG SAAT DIPUTAR)
  const playBtn = document.getElementById('play');
  const stageEl = document.getElementById('stage');
  const viewCanvas = document.getElementById('view');
  const bigPlayBtn = document.getElementById('bigPlayBtn');
  const stageHint = document.querySelector('.stage-hint');

  const updatePlayingState = () => {
    if (!playBtn) return;
    const txt = (playBtn.textContent || '').trim();
    const hasPauseIcon = !!playBtn.querySelector('use[href*="pause"], use[*|href*="pause"]');
    const isPlaying = txt.includes('Jeda') || hasPauseIcon;

    if (stageEl) stageEl.classList.toggle('is-playing', isPlaying);
    playBtn.classList.toggle('is-paused-mode', isPlaying);
    if (stageHint) {
      stageHint.classList.toggle('is-playing', isPlaying);
      stageHint.style.display = isPlaying ? 'none' : 'flex';
      stageHint.style.opacity = isPlaying ? '0' : '1';
      stageHint.style.pointerEvents = isPlaying ? 'none' : 'auto';
    }
    if (bigPlayBtn) {
      bigPlayBtn.style.display = isPlaying ? 'none' : 'flex';
    }
  };

  if (playBtn) {
    new MutationObserver(updatePlayingState).observe(playBtn, { childList: true, subtree: true, characterData: true });
    playBtn.addEventListener('click', () => setTimeout(updatePlayingState, 60));
    setInterval(updatePlayingState, 250);
  }

  // Klik tombol Play besar di tengah langsung memutar video
  bigPlayBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (playBtn) playBtn.click();
    setTimeout(updatePlayingState, 60);
  });

  // Klik pada kanvas video (stage) untuk toggle Play / Jeda instan
  viewCanvas?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (playBtn) playBtn.click();
    setTimeout(updatePlayingState, 60);
  });

  // 8b. SLOT FOTO/VIDEO: tanpa galeri. "Ganti" langsung membuka pemilih file perangkat.
  // File hanya dipakai di memori halaman ini (blob), tidak diunggah ke server dan tidak disimpan.
  const mediaRows = document.getElementById('mediaRows');
  const slotSwapState = document.getElementById('slotSwapState');
  const slotCountBadge = document.getElementById('slotCount');

  const showSwapState = (text, color) => {
    if (!slotSwapState) return;
    slotSwapState.style.display = text ? 'block' : 'none';
    slotSwapState.style.color = color || '';
    slotSwapState.textContent = text || '';
  };

  // Rapikan daftar slot yang dibuat engine: sembunyikan media yang hanya sumber musik,
  // beri label tombol sesuai jenis, dan hitung jumlah slot yang tampil.
  let tidying = false;
  function tidySlots() {
    if (!mediaRows || tidying) return;
    tidying = true;
    try {
      const fills = window.__amFillMedia;
      let visible = 0;
      mediaRows.querySelectorAll('.slot').forEach((row) => {
        const sub = row.querySelector('.slot-sub');
        const id = sub?.getAttribute('title') || '';
        const hide = !!(fills && id && !fills.has(id));
        if (row.hidden !== hide) row.hidden = hide;
        if (hide) return;
        visible++;
        const isVideo = !!row.querySelector('.badge.video');
        const label = row.querySelector('.swap-btn span');
        const wantedBtn = isVideo ? 'Ganti video' : 'Ganti foto';
        if (label && label.textContent !== wantedBtn) label.textContent = wantedBtn;
        // Penomoran mengikuti slot yang tampil (slot sumber musik tidak dihitung).
        const title = row.querySelector('.slot-title > span:not(.badge)');
        if (title && title.textContent !== `Slot ${visible}`) title.textContent = `Slot ${visible}`;
        // Sub-label: nama file yang baru dipasang pengguna, atau nama media asli preset.
        const picked = window.__slotPicked && window.__slotPicked[id];
        const wantedSub = picked ? `Diganti: ${picked}` : (sub?.textContent.startsWith('amproj:') ? sub.textContent.slice(7) : sub?.textContent);
        if (sub && wantedSub && sub.textContent !== wantedSub) sub.textContent = wantedSub;

        // CapCut Badge 1: Nomor Klip (1, 2, 3...) di pojok kiri atas thumbnail
        let clipNum = row.querySelector('.slot-clip-num');
        if (!clipNum) {
          clipNum = document.createElement('span');
          clipNum.className = 'slot-clip-num';
          row.appendChild(clipNum);
        }
        if (clipNum.textContent !== String(visible)) clipNum.textContent = String(visible);

        // CapCut Badge 2: Durasi Klip (misal 13.6s, 5.5s) di bagian bawah thumbnail
        let maxLayerDur = 0;
        (window.__amBase || []).forEach((doc) => {
          try {
            const dom = new DOMParser().parseFromString(doc.xml, 'application/xml');
            const shapes = Array.from(dom.getElementsByTagName('shape'));
            shapes.forEach((s) => {
              const fill = s.getAttribute('fillImage') || s.getAttribute('fillVideo') || '';
              if (!fill) return;
              const cleanFill = fill.replace(/^amproj:/, '');
              const cleanSlot = (id || '').replace(/^amproj:/, '');
              if (fill === id || cleanFill === cleanSlot || fill.endsWith(cleanSlot) || cleanSlot.endsWith(cleanFill)) {
                const start = parseFloat(s.getAttribute('startTime')) || 0;
                const end = parseFloat(s.getAttribute('endTime')) || 0;
                const d = end - start;
                if (d > maxLayerDur) maxLayerDur = d;
              }
            });
          } catch (_) {}
        });
        const durText = maxLayerDur > 0 ? `${(maxLayerDur / 1000).toFixed(1)}s` : '3.0s';
        let clipDur = row.querySelector('.slot-clip-dur');
        if (!clipDur) {
          clipDur = document.createElement('span');
          clipDur.className = 'slot-clip-dur';
          row.appendChild(clipDur);
        }
        if (clipDur.textContent !== durText) clipDur.textContent = durText;

        // Tombol 'Atur' framing jika bukan video dan sudah ada foto pengganti atau foto asli
        if (!isVideo) {
          if (!row.querySelector('.btn-slot-crop')) {
            const cropBtn = document.createElement('button');
            cropBtn.type = 'button';
            cropBtn.className = 'btn-slot-crop';
            cropBtn.title = 'Atur framing / posisi foto';
            cropBtn.innerHTML = '<svg class="i-btn sm" style="width:14px;height:14px;"><use xlink:href="#i-settings"></use></svg><span>Atur</span>';
            cropBtn.addEventListener('click', (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              const rowsArr = Array.from(document.querySelectorAll('#mediaRows .slot'));
              const sObj = (window.AM && window.AM.getMediaSlots ? window.AM.getMediaSlots() : [])[rowsArr.indexOf(row)];
              if (!sObj) return;
              const rawData = window.__slotRawFiles && window.__slotRawFiles[id];
              if (rawData && rawData.rawFile && typeof window.__openFramingModal === 'function') {
                window.__openFramingModal(sObj, rawData.rawFile, rawData.settings);
              } else {
                // Belum ada foto pengganti: pic file terlebih dahulu
                const swapBtn = row.querySelector('.swap-btn');
                if (swapBtn) swapBtn.click();
              }
            });
            row.appendChild(cropBtn);
          }
        }
      });
      window.__tidySlots = tidySlots;
      if (slotCountBadge && mediaRows.querySelector('.slot')) {
        const txt = `${visible} slot`;
        if (slotCountBadge.textContent !== txt) slotCountBadge.textContent = txt;
      }
    } finally {
      tidying = false;
    }
  };
  if (mediaRows) {
    new MutationObserver(() => tidySlots()).observe(mediaRows, { childList: true, subtree: true });
    tidySlots();
  }

  // Tombol Reset mengembalikan media asli preset: buang juga catatan "Diganti".
  document.getElementById('impReset')?.addEventListener('click', () => {
    window.__slotPicked = {};
    window.__slotFiles = {};
    showSwapState('');
    setTimeout(tidySlots, 400);
  });

  const slotFileInput = document.createElement('input');
  slotFileInput.type = 'file';
  slotFileInput.hidden = true;
  document.body.appendChild(slotFileInput);

  // Tangkap klik pada kartu klip / thumbnail foto untuk langsung ganti media (1-Tap ala CapCut)
  document.addEventListener('click', (e) => {
    // Jika klik tombol atur / crop framing, biarkan handler crop yang memprosesnya
    if (e.target.closest && e.target.closest('.btn-slot-crop')) return;

    // Tangkap klik di manapun pada kartu slot
    const slotCard = e.target.closest && e.target.closest('#mediaRows .slot');
    if (!slotCard) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const rows = Array.from(document.querySelectorAll('#mediaRows .slot'));
    const slot = (window.AM && window.AM.getMediaSlots ? window.AM.getMediaSlots() : [])[rows.indexOf(slotCard)];
    if (!slot) {
      showSwapState('Slot belum siap, coba lagi sebentar.', '#f87171');
      return;
    }

    slotFileInput.accept = slot.type === 'video' ? 'video/*' : 'image/*';
    slotFileInput.onchange = async () => {
      const file = slotFileInput.files && slotFileInput.files[0];
      slotFileInput.value = '';
      if (!file) return;

      // Jika file adalah gambar: buka Modal Framing untuk cegah gepeng & framing
      if (file.type.startsWith('image/') && typeof window.__openFramingModal === 'function') {
        window.__openFramingModal(slot, file);
        return;
      }

      // Jika video: pasang langsung
      const unique = new File([file], `${Date.now().toString(36)}_${file.name}`, { type: file.type });
      showSwapState(`Memasang ${file.name}...`, '#cbd5e1');
      try {
        await window.AM.applyMedia(slot.id, unique);
        window.__slotPicked = Object.assign(window.__slotPicked || {}, { [slot.id]: file.name });
        window.__slotFiles = Object.assign(window.__slotFiles || {}, { [slot.id]: unique });
        tidySlots();
        showSwapState(`Terpasang: ${file.name}`, '#34d399');
      } catch (err) {
        console.error('[Ganti media]', err);
        showSwapState(`Gagal memasang file: ${err.message}`, '#f87171');
      }
    };
    slotFileInput.click();
  }, true);

  // 8c. TEKS PRESET: ubah isi / hapus teks (mis. catatan atau kredit di preset).
  // Engine tidak punya API edit teks, jadi XML preset diedit (isi <content> atau hidden="true"),
  // lalu preset dimuat ulang. Foto & musik pilihan pengguna dipasang kembali setelahnya.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const textRowsEl = document.getElementById('textRows');
  const textApplyBtn = document.getElementById('textApply');
  const textRevertBtn = document.getElementById('textRevert');
  const textStateEl = document.getElementById('textState');
  const textCountEl = document.getElementById('textCount');
  let appliedEdits = '{}';   // snapshot edit yang sudah diterapkan ke preview
  let applyingText = false;
  let nestedOpen = false;

  const showTextState = (msg, color) => {
    if (!textStateEl) return;
    textStateEl.style.display = msg ? 'block' : 'none';
    textStateEl.style.color = color || '';
    textStateEl.textContent = msg || '';
  };
  const fmtSec = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const parseXml = (xml) => new DOMParser().parseFromString(xml, 'application/xml');

  // Daftar layer teks dari XML dasar (urut kemunculan di preview)
  const listTexts = () => {
    const out = [];
    (window.__amBase || []).forEach((doc, di) => {
      const dom = parseXml(doc.xml);
      const root = dom.documentElement;
      const total = parseFloat(root.getAttribute('totalTime')) || 0;
      Array.from(dom.getElementsByTagName('text')).forEach((el, ti) => {
        if (el.getAttribute('hidden') === 'true') return; // sudah disembunyikan oleh pembuat preset
        const content = el.getElementsByTagName('content')[0]?.textContent ?? '';
        if (!content.trim()) return;
        out.push({
          key: `${di}:${ti}`, content, total,
          nested: el.parentNode !== root,
          start: parseFloat(el.getAttribute('startTime')) || 0,
          end: parseFloat(el.getAttribute('endTime')) || 0
        });
      });
    });
    return out.sort((a, b) => (a.nested - b.nested) || (a.start - b.start));
  };

  const isDirty = () => JSON.stringify(window.__textEdits) !== appliedEdits;
  const hasApplied = () => appliedEdits !== '{}';

  const refreshTextButtons = () => {
    if (!textApplyBtn || !textRevertBtn) return;
    const dirty = isDirty();
    textApplyBtn.disabled = applyingText || !dirty;
    textRevertBtn.disabled = applyingText || !(dirty || hasApplied());
    const lbl = textRevertBtn.querySelector('span');
    if (lbl) lbl.textContent = dirty ? 'Batalkan perubahan' : 'Kembalikan teks asli';
  };

  const renderTexts = () => {
    if (!textRowsEl) return;
    const items = listTexts();
    const nestedCount = items.filter((i) => i.nested).length;
    if (textCountEl) textCountEl.textContent = `${items.length - nestedCount} teks`;
    if (!items.length) {
      textRowsEl.innerHTML = '<div class="empty-hint">Preset ini tidak punya teks.</div>';
      refreshTextButtons();
      return;
    }
    textRowsEl.innerHTML = '';
    // Teks di dalam grup animasi (potongan kata/huruf) dilipat agar daftar utama tetap ringkas.
    let nestedBox = null;
    const ensureNestedBox = () => {
      if (nestedBox) return nestedBox;
      const details = document.createElement('details');
      details.className = 'text-nested';
      details.open = nestedOpen;
      details.addEventListener('toggle', () => { nestedOpen = details.open; });
      const summary = document.createElement('summary');
      summary.textContent = `Teks di dalam grup animasi (${nestedCount})`;
      nestedBox = document.createElement('div');
      nestedBox.className = 'text-rows';
      details.append(summary, nestedBox);
      textRowsEl.appendChild(details);
      return nestedBox;
    };
    items.forEach((it, n) => {
      const edit = window.__textEdits[it.key] || {};
      const row = document.createElement('div');
      row.className = 'text-row';
      row.dataset.key = it.key;

      const head = document.createElement('div');
      head.className = 'text-row-head';
      const idx = document.createElement('span');
      idx.className = 'text-idx';
      idx.textContent = `Teks ${n + 1}`;
      const time = document.createElement('button');
      time.type = 'button';
      time.className = 'text-time';
      time.textContent = it.nested ? 'dalam grup' : `${fmtSec(it.start)} - ${fmtSec(it.end)}`;
      time.title = it.nested ? 'Teks ini berada di dalam grup layer' : 'Lihat teks ini di preview';
      if (!it.nested) {
        time.addEventListener('click', () => {
          const seek = document.getElementById('seek');
          if (!seek || !it.total) return;
          const at = Math.min(it.start + Math.min(250, (it.end - it.start) / 2), it.total - 1);
          seek.value = Math.round((at / it.total) * (parseFloat(seek.max) || 10000));
          seek.dispatchEvent(new Event('input', { bubbles: true }));
          seek.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
      const flag = document.createElement('span');
      flag.className = 'text-flag';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn sm';
      head.append(idx, time, flag, del);

      const area = document.createElement('textarea');
      area.className = 'text-input';
      area.rows = Math.min(6, Math.max(2, it.content.split('\n').length));
      area.value = edit.content !== undefined ? edit.content : it.content;
      area.spellcheck = false;

      const paint = () => {
        const e = window.__textEdits[it.key] || {};
        const removed = !!e.hidden;
        const edited = e.content !== undefined;
        row.classList.toggle('is-removed', removed);
        row.classList.toggle('is-edited', edited && !removed);
        flag.textContent = removed ? 'akan dihapus' : (edited ? 'diubah' : '');
        flag.classList.toggle('removed', removed);
        del.textContent = removed ? 'Kembalikan' : 'Hapus';
        area.disabled = removed || applyingText;
      };

      area.addEventListener('input', () => {
        const e = Object.assign({}, window.__textEdits[it.key]);
        if (area.value === it.content) delete e.content; else e.content = area.value;
        if (Object.keys(e).length) window.__textEdits[it.key] = e; else delete window.__textEdits[it.key];
        paint();
        refreshTextButtons();
        showTextState('');
      });
      del.addEventListener('click', () => {
        const e = Object.assign({}, window.__textEdits[it.key]);
        if (e.hidden) delete e.hidden; else e.hidden = true;
        if (Object.keys(e).length) window.__textEdits[it.key] = e; else delete window.__textEdits[it.key];
        paint();
        refreshTextButtons();
        showTextState('');
      });

      row.append(head, area);
      (it.nested ? ensureNestedBox() : textRowsEl).appendChild(row);
      paint();
    });
    refreshTextButtons();
  };

  // Tunggu engine selesai memuat (overlay loading muncul lalu hilang)
  const waitEngineIdle = async () => {
    const busy = () => !!(window.AM && window.AM.getState && window.AM.getState().isBusy);
    const t0 = Date.now();
    let seen = false;
    while (Date.now() - t0 < 120000) {
      await sleep(250);
      if (busy()) { seen = true; continue; }
      if (seen || Date.now() - t0 > 4000) {
        await sleep(500);
        if (!busy()) return;
      }
    }
    throw new Error('waktu memuat ulang habis');
  };

    // Fungsi pembantu memperbarui opsi resolusi ekspor (#expRes) sesuai rasio aktif
  const updateExportResolutionOptions = (targetRatio) => {
    const expRes = document.getElementById('expRes');
    if (!expRes) return;
    const st = window.AM && window.AM.getState ? window.AM.getState() : null;
    let w = st?.width || 1080;
    let h = st?.height || 1920;
    if (targetRatio && targetRatio !== 'original') {
      const rm = { '1:1': [1080, 1080], '9:16': [1080, 1920], '16:9': [1920, 1080], '4:5': [1080, 1350], '3:4': [1080, 1440] };
      if (rm[targetRatio]) { [w, h] = rm[targetRatio]; }
    }
    const r = w / h;
    const isPortrait = r < 1;

    Array.from(expRes.options).forEach((opt) => {
      const val = parseInt(opt.value, 10);
      if (isNaN(val)) return;
      let outW, outH;
      if (isPortrait) {
        outW = val;
        outH = Math.round(val / r);
      } else {
        outH = val;
        outW = Math.round(val * r);
      }
      if (val === 720) opt.textContent = `${outW}x${outH} (720p HD)`;
      else if (val === 1080) opt.textContent = `${outW}x${outH} (1080p Full HD)`;
      else if (val === 480) opt.textContent = `${outW}x${outH} (480p SD)`;
      else if (val === 1440) opt.textContent = `${outW}x${outH} (2K Ultra HD)`;
    });
  };

  const buildXmlFiles = (textEdits, ratioConfig) => {
    const rConfig = ratioConfig || window.__presetRatioConfig || { ratio: 'original', mode: 'fit' };
    const tEdits = textEdits || window.__textEdits || {};

    return (window.__amBase || []).map((doc, di) => {
      let xmlStr = doc.xml;
      if (rConfig.ratio !== 'original' && typeof window.__transformPresetXml === 'function') {
        xmlStr = window.__transformPresetXml(xmlStr, rConfig.ratio, rConfig.mode);
      }
      const dom = parseXml(xmlStr);
      Array.from(dom.getElementsByTagName('text')).forEach((el, ti) => {
        const e = tEdits[`${di}:${ti}`];
        if (!e) return;
        if (e.hidden) el.setAttribute('hidden', 'true');
        if (e.content !== undefined) {
          const c = el.getElementsByTagName('content')[0];
          if (c) c.textContent = e.content;
        }
      });
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(dom.documentElement);
      return new File([xml], doc.name, { type: 'text/xml' });
    });
  };

  const reloadWithEdits = async (textEdits, ratioConfig) => {
    const impXmlInput = document.getElementById('impXml');
    const rConfig = ratioConfig || window.__presetRatioConfig || { ratio: 'original', mode: 'fit' };
    const files = buildXmlFiles(textEdits, rConfig);
    if (!impXmlInput || !files.length) throw new Error('XML preset tidak tersedia');
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    impXmlInput.files = dt.files;
    impXmlInput.__xmlFixed = true; // XML dasar sudah diperbaiki: lewati pencegat, catatan XML tetap
    try { impXmlInput.dispatchEvent(new Event('change', { bubbles: true })); } finally { impXmlInput.__xmlFixed = false; }
    await waitEngineIdle();

    // Re-render foto jika rasio berubah dan ada slotRawFiles
    if (window.__slotRawFiles && typeof window.__computeSlotAspect === 'function' && typeof window.__renderFramedImage === 'function') {
      for (const [slotId, item] of Object.entries(window.__slotRawFiles)) {
        try {
          const newDisp = window.__computeSlotAspect(slotId);
          const reframed = await window.__renderFramedImage(item.img, newDisp, item.settings);
          window.__slotFiles[slotId] = reframed;
        } catch (err) {
          console.warn('[Reload] Gagal re-frame foto', slotId, err);
        }
      }
    }

    // Pasang kembali pilihan pengguna: foto/video pengganti, lalu musik kustom
    for (const [slotId, file] of Object.entries(window.__slotFiles || {})) {
      try { await window.AM.applyMedia(slotId, file); } catch (err) { console.warn('[Reload] gagal pasang ulang media', slotId, err); }
    }
    if (window.__customAudio) {
      await applyEngineAudio(window.__customAudio);
      await sleep(300);
      await waitEngineIdle();
    }
    updateExportResolutionOptions(rConfig.ratio);
  };

  // Handler aplikasi rasio preset
  window.__applyPresetRatio = async (newConfig) => {
    window.__presetRatioConfig = Object.assign({}, newConfig);
    await reloadWithEdits(window.__textEdits, window.__presetRatioConfig);
    tidySlots();
    renderTexts();
  };

  const setTextBusy = (on) => {
    applyingText = on;
    textRowsEl?.querySelectorAll('textarea, button').forEach((el) => {
      if (on) el.disabled = true;
    });
    if (!on) renderTexts(); // bangun ulang agar status tiap baris benar
    refreshTextButtons();
  };

  const applyTexts = async (edits, okMessage) => {
    if (applyingText) return;
    setTextBusy(true);
    showTextState('Menerapkan perubahan teks...', '#cbd5e1');
    try {
      await reloadWithEdits(edits);
      appliedEdits = JSON.stringify(edits);
      window.__textEdits = JSON.parse(appliedEdits);
      showTextState(okMessage, '#34d399');
    } catch (err) {
      console.error('[Teks]', err);
      showTextState(`Gagal menerapkan: ${err.message}`, '#f87171');
    } finally {
      setTextBusy(false);
    }
  };

  textApplyBtn?.addEventListener('click', () => {
    const n = Object.keys(window.__textEdits).length;
    applyTexts(JSON.parse(JSON.stringify(window.__textEdits)), `Selesai: ${n} teks diubah/dihapus.`);
  });
  textRevertBtn?.addEventListener('click', () => {
    if (isDirty()) {
      window.__textEdits = JSON.parse(appliedEdits); // kembali ke kondisi yang sedang tampil di preview
      renderTexts();
      showTextState('Perubahan yang belum diterapkan dibatalkan.', '#cbd5e1');
    } else {
      applyTexts({}, 'Teks dikembalikan ke aslinya.');
    }
  });

  // Preset baru dimuat (link / upload): daftar teks & status edit dimulai dari awal.
  window.__onXmlRegistered = () => {
    appliedEdits = '{}';
    window.__presetRatioConfig = { ratio: 'original', mode: 'fit' };
    const curBadge = document.getElementById('currentRatioBadge');
    if (curBadge) curBadge.textContent = 'Asli';
    const chips = document.getElementById('presetRatioChips');
    if (chips) {
      chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.ratio === 'original'));
    }
    const rad = document.querySelector('input[name="ratioFitMode"][value="fit"]');
    if (rad) rad.checked = true;
    if (typeof window.__refreshRatioButtons === 'function') window.__refreshRatioButtons();
    updateExportResolutionOptions('original');
    showTextState('');
    renderTexts();
    setTimeout(tidySlots, 0);
  };
  renderTexts();

  // Preset bawaan dimuat sendiri oleh engine tanpa melewati app ini: ambil XML-nya agar teks bisa diedit.
  let baseCaptureTries = 0;
  const captureDefaultXml = async () => {
    if (window.__amBase || baseCaptureTries++ > 40) return;
    const total = (document.getElementById('timeLabel')?.textContent || '').split('/')[1] || '';
    if (!(parseFloat(total) > 0)) { setTimeout(captureDefaultXml, 1000); return; }
    try {
      const text = await (await fetch('./runtime/presets/Beraksi.xml')).text();
      const title = parseXml(text).documentElement.getAttribute('title') || '';
      const engineTitle = (window.AM && window.AM.getState && window.AM.getState().title) || '';
      if (title && engineTitle && (engineTitle === title || engineTitle.includes(title) || title.includes(engineTitle))) {
        const fixed = fixPathRectMediaShapes(text);
        registerXmlMediaUsage(fixed.xml, ['Beraksi.xml']);
      }
    } catch (err) { /* daftar teks kosong untuk preset ini */ }
  };
  setTimeout(captureDefaultXml, 1500);

  // 8d. LAYAR UTAMA & LAYAR SAMBUTAN:
  const byId = (id) => document.getElementById(id);
  const homeScreen = byId('homeScreen');
  const btnEnterStudio = byId('btnEnterStudio');
  const btnBackToHome = byId('btnBackToHome');
  const welcome = byId('welcome');
  const wLink = byId('welcomeLink');
  const wGo = byId('welcomeGo');
  const wPaste = byId('welcomePaste');
  const wXml = byId('welcomeXml');
  const wSkip = byId('welcomeSkip');
  const wStatus = byId('welcomeStatus');
  const toastEl = byId('toast');
  let toastTimer = null;

  const openHome = () => {
    if (!homeScreen) return;
    homeScreen.hidden = false;
    requestAnimationFrame(() => homeScreen.classList.remove('is-closing'));
  };

  const closeHome = () => {
    if (!homeScreen || homeScreen.hidden) return;
    homeScreen.classList.add('is-closing');
    setTimeout(() => { homeScreen.hidden = true; }, 280);
  };

  const toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 4200);
  };
  window.__toast = toast;

  const setWelcomeStatus = (kind, title, desc) => {
    if (!wStatus) return;
    wStatus.hidden = !kind;
    wStatus.classList.toggle('is-error', kind === 'error');
    byId('welcomeStatusTitle').textContent = title || '';
    byId('welcomeStatusDesc').textContent = desc || '';
  };
  const lockWelcome = (on) => {
    welcome?.classList.toggle('is-busy', on);
    [wLink, wGo, wPaste, wXml, wSkip].forEach((el) => { if (el) el.disabled = on; });
  };
  const goToTab = (name) => document.querySelector(`.tab-btn[data-tab="${name}"]`)?.click();

  const closeWelcome = () => {
    if (!welcome || welcome.hidden) return;
    welcome.classList.add('is-closing');
    setTimeout(() => { welcome.hidden = true; }, 320);
  };
  const openWelcome = () => {
    if (!welcome) return;
    welcome.hidden = false;
    setWelcomeStatus(null);
    lockWelcome(false);
    requestAnimationFrame(() => welcome.classList.remove('is-closing'));
  };

  // Link Alight Motion: memakai alur impor yang sama dengan tab Preset (satu sumber kebenaran).
  const importFromWelcome = async () => {
    const link = (wLink.value || '').trim();
    if (!link) {
      setWelcomeStatus('error', 'Masukkan link dulu', 'Contoh: https://alightcreative.com/am/share/...');
      return;
    }
    const isAm = /alightcreative\.com|alight\.link/i.test(link);
    const isDrive = link.includes('drive.google.com');
    const isXml = link.toLowerCase().includes('.xml');
    const isHttp = link.startsWith('http://') || link.startsWith('https://');

    if (!isHttp || (!isAm && !isDrive && !isXml)) {
      setWelcomeStatus('error', 'Link tidak valid', 'Gunakan link resmi Alight Motion, Google Drive XML, atau URL XML preset.');
      return;
    }
    const amInput = byId('customUrlAmInput');
    const amBtn = byId('btnFetchAm');
    const amBox = byId('customUrlAmStatus');
    if (!amInput || !amBtn || !amBox) return;

    lockWelcome(true);
    setWelcomeStatus('loading', 'Menghubungkan ke sumber preset...', 'Mengambil XML dan aset media...');
    amBox.className = 'link-status-box';   // buang status lama agar tidak terbaca sebagai hasil impor ini
    amBox.style.display = 'none';
    amInput.value = link;
    amBtn.click();

    const t0 = Date.now();
    let outcome = null;
    while (Date.now() - t0 < 120000) {
      await sleep(300);
      const cls = amBox.className;
      const title = byId('statusAmTitle')?.textContent || '';
      const desc = byId('statusAmDesc')?.textContent || '';
      if (cls.includes('success')) { outcome = { ok: true, title, desc }; break; }
      if (cls.includes('error')) { outcome = { ok: false, title, desc }; break; }
      if (title) setWelcomeStatus('loading', title, desc);
    }
    if (outcome && outcome.ok) {
      const multi = byId('customUrlAmPickRow') && getComputedStyle(byId('customUrlAmPickRow')).display !== 'none';
      closeWelcome();
      lockWelcome(false);
      goToTab(multi ? 'proyek' : 'media');
      toast(outcome.desc ? `${outcome.title}: ${outcome.desc}` : 'Preset berhasil dimuat.');
    } else {
      lockWelcome(false);
      setWelcomeStatus('error', outcome ? outcome.title : 'Waktu habis', outcome ? outcome.desc : 'Preset tidak selesai dimuat. Coba lagi.');
    }
  };

  // File XML: masuk lewat input engine (melewati perbaikan XML), lalu tunggu selesai.
  const importXmlFromWelcome = async () => {
    const files = Array.from(wXml.files || []);
    if (!files.length) return;
    window.__cancelAutoLoad = true;
    window.__presetLoaded = true;
    lockWelcome(true);
    setWelcomeStatus('loading', 'Membaca preset...', files.map((f) => f.name).join(', '));
    const seq = window.__xmlLoadSeq || 0;
    const engineInput = byId('impXml');
    try {
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      engineInput.files = dt.files;
      engineInput.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
      await waitEngineIdle();
      if ((window.__xmlLoadSeq || 0) === seq) throw new Error('File ini bukan XML preset Alight Motion yang valid.');
      closeWelcome();
      goToTab('media');
      toast('Preset dimuat. Media di file XML tidak ikut, ganti fotonya sendiri.');
    } catch (err) {
      setWelcomeStatus('error', 'Gagal memuat preset', err.message);
    } finally {
      lockWelcome(false);
      wXml.value = '';
    }
  };

  // ?nowelcome: langsung ke editor tanpa layar home / sambutan (untuk tes otomatis / pemakaian cepat)
  if (new URLSearchParams(location.search).has('nowelcome')) {
    if (homeScreen) homeScreen.hidden = true;
    if (welcome) welcome.hidden = true;
  }

  btnEnterStudio?.addEventListener('click', () => {
    closeHome();
    openWelcome();
  });

  btnBackToHome?.addEventListener('click', () => {
    closeWelcome();
    openHome();
  });

  wGo?.addEventListener('click', importFromWelcome);
  wLink?.addEventListener('keydown', (e) => { if (e.key === 'Enter') importFromWelcome(); });
  wLink?.addEventListener('input', () => setWelcomeStatus(null));
  wXml?.addEventListener('change', importXmlFromWelcome);
  wSkip?.addEventListener('click', () => { window.__cancelAutoLoad = true; closeWelcome(); });
  byId('reopenWelcome')?.addEventListener('click', () => {
    closeHome();
    openWelcome();
  });

  // Modal Ekspor Video MP4 dari Header
  const exportModal = byId('exportModal');
  byId('headerExportBtn')?.addEventListener('click', () => {
    if (exportModal) {
      if (typeof exportModal.showModal === 'function') {
        exportModal.showModal();
      } else {
        exportModal.hidden = false;
        exportModal.style.display = 'block';
      }
    }
  });
  byId('closeExportModal')?.addEventListener('click', () => {
    if (exportModal) {
      if (typeof exportModal.close === 'function') {
        exportModal.close();
      } else {
        exportModal.hidden = true;
        exportModal.style.display = 'none';
      }
    }
  });

  // Tombol Back Android (dipanggil MainActivity.onBackPressed): true = sudah ditangani halaman.
  window.__androidBack = () => {
    if (exportModal && exportModal.open) { exportModal.close(); return true; }
    const framing = byId('framingModal');
    if (framing && framing.style.display === 'flex') { byId('btnFramingClose')?.click(); return true; }
    if (homeScreen && !homeScreen.hidden) return false;   // di beranda: keluar aplikasi
    btnBackToHome?.click();                               // dari pilih sumber / editor: kembali ke beranda
    return true;
  };
  wPaste?.addEventListener('click', async () => {
    try {
      const text = navigator.clipboard && navigator.clipboard.readText ? await navigator.clipboard.readText() : '';
      if (/^https?:\/\//i.test((text || '').trim())) { wLink.value = text.trim(); setWelcomeStatus(null); return; }
    } catch (err) { /* izin clipboard ditolak: fokus ke kolom agar bisa tempel manual */ }
    wLink.focus();
    wLink.select();
  });

  // Ciutkan / besarkan preview. Engine menghitung ulang ukuran kanvas saat event resize.
  const stageToggle = byId('stageToggle');
  stageToggle?.addEventListener('click', () => {
    const screen = byId('appScreen');
    const mini = screen.classList.toggle('player-mini');
    stageToggle.setAttribute('aria-pressed', String(mini));
    stageToggle.title = mini ? 'Besarkan preview' : 'Kecilkan preview';
    stageToggle.querySelector('use')?.setAttribute('href', mini ? '#i-chevron-down' : '#i-chevron-up'); // href polos menang atas xlink:href
    setTimeout(() => window.dispatchEvent(new Event('resize')), 280);
  });

  // Jam pada status bar palsu
  const clockEl = byId('sbTime');
  const tickClock = () => {
    if (!clockEl) return;
    const d = new Date();
    clockEl.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  tickClock();
  setInterval(tickClock, 15000);

  // 9. Auto-load aman: hanya jalan jika engine belum punya preset dan pengguna belum berinteraksi.
  // Pengguna yang sudah menyentuh apa pun (klik/ketik) tidak boleh ditimpa preset default,
  // karena me-load ulang XML membuang semua penggantian media.
  ['pointerdown', 'keydown'].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      if (e.isTrusted) window.__cancelAutoLoad = true;
    }, { capture: true, once: true });
  });

  function engineHasPreset() {
    const total = (document.getElementById('timeLabel')?.textContent || '').split('/')[1] || '';
    return parseFloat(total) > 0; // "0.00s / 18.48s" -> ada preset; "0.00s / 0.00s" -> kosong
  }

  const checkAndAutoLoad = () => {
    if (window.__presetLoaded || window.__cancelAutoLoad) return;

    // Jangan jalankan jika pengguna sudah menempelkan link
    if (customUrlAmInput && customUrlAmInput.value.trim().length > 0) {
      window.__cancelAutoLoad = true;
      return;
    }

    // Engine sudah memuat preset bawaannya sendiri: tidak perlu memuat ulang.
    if (engineHasPreset()) {
      window.__presetLoaded = true;
      return;
    }

    // Pakai status overlay yang sebenarnya, bukan teks label (teks label tetap tersisa setelah selesai).
    const stageBusy = document.getElementById('stageBusy');
    if (stageBusy && !stageBusy.hidden) {
      autoLoadTimer = setTimeout(checkAndAutoLoad, 800);
      return;
    }

    loadInitialDefaultPreset();
  };

  autoLoadTimer = setTimeout(checkAndAutoLoad, 2500);
});


// =====================================================================
// MODUL RASIO PRESET & FRAMING FOTO (XEDITZ STUDIO)
// =====================================================================

(function initRatioAndFramingModule() {
  window.__presetRatioConfig = window.__presetRatioConfig || { ratio: 'original', mode: 'fit' };
  window.__slotRawFiles = window.__slotRawFiles || {}; // slotId -> { rawFile, settings, img }
  
  let appliedRatioConfig = JSON.stringify({ ratio: 'original', mode: 'fit' });
  let pendingRatio = 'original';
  let pendingFitMode = 'fit';

  const RATIO_MAP = {
    '1:1': [1080, 1080],
    '9:16': [1080, 1920],
    '16:9': [1920, 1080],
    '4:5': [1080, 1350],
    '3:4': [1080, 1440]
  };

  // 1. Transformasi Afin XML untuk Rasio Preset
  function transformPresetXml(xmlText, targetRatio, fitMode) {
    if (!targetRatio || targetRatio === 'original' || !RATIO_MAP[targetRatio]) {
      return xmlText;
    }
    const dom = new DOMParser().parseFromString(xmlText, 'application/xml');
    const root = dom.documentElement;
    if (!root) return xmlText;

    const [newW, newH] = RATIO_MAP[targetRatio];
    const oldW = parseFloat(root.getAttribute('width')) || 1080;
    const oldH = parseFloat(root.getAttribute('height')) || 1920;

    const kw = newW / oldW;
    const kh = newH / oldH;
    const k = fitMode === 'fit' ? Math.min(kw, kh) : Math.max(kw, kh);

    const cx0 = oldW / 2;
    const cy0 = oldH / 2;
    const cx1 = newW / 2;
    const cy1 = newH / 2;

    root.setAttribute('width', String(Math.round(newW)));
    root.setAttribute('height', String(Math.round(newH)));
    root.setAttribute('exportWidth', String(Math.round(newW)));
    root.setAttribute('exportHeight', String(Math.round(newH)));

    // Transformasi layer tingkat atas (anak langsung root tanpa parent)
    const children = Array.from(root.children);
    children.forEach((child) => {
      if (child.tagName === 'audio') return;
      if (child.getAttribute('parent')) return;

      let trans = child.getElementsByTagName('transform')[0];
      if (!trans) {
        trans = dom.createElement('transform');
        child.appendChild(trans);
      }

      // Location
      let loc = trans.getElementsByTagName('location')[0];
      if (loc) {
        const valStr = loc.getAttribute('value');
        if (valStr) {
          const parts = valStr.split(',').map(parseFloat);
          if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            parts[0] = cx1 + k * (parts[0] - cx0);
            parts[1] = cy1 + k * (parts[1] - cy0);
            loc.setAttribute('value', parts.map((n) => n.toFixed(6)).join(','));
          }
        }
        Array.from(loc.getElementsByTagName('kf')).forEach((kf) => {
          const kfVal = kf.getAttribute('v');
          if (kfVal) {
            const parts = kfVal.split(',').map(parseFloat);
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              parts[0] = cx1 + k * (parts[0] - cx0);
              parts[1] = cy1 + k * (parts[1] - cy0);
              kf.setAttribute('v', parts.map((n) => n.toFixed(6)).join(','));
            }
          }
        });
      }

      // Scale
      let scale = trans.getElementsByTagName('scale')[0];
      if (scale) {
        const valStr = scale.getAttribute('value');
        if (valStr) {
          const parts = valStr.split(',').map(parseFloat);
          if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            parts[0] *= k;
            parts[1] *= k;
            scale.setAttribute('value', parts.map((n) => n.toFixed(6)).join(','));
          }
        }
        Array.from(scale.getElementsByTagName('kf')).forEach((kf) => {
          const kfVal = kf.getAttribute('v');
          if (kfVal) {
            const parts = kfVal.split(',').map(parseFloat);
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              parts[0] *= k;
              parts[1] *= k;
              kf.setAttribute('v', parts.map((n) => n.toFixed(6)).join(','));
            }
          }
        });
      } else {
        const scEl = dom.createElement('scale');
        scEl.setAttribute('value', `${k.toFixed(6)},${k.toFixed(6)}`);
        trans.appendChild(scEl);
      }
    });

    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(root);
  }

  // 2. Perhitungan Rasio Tampilan Efektif Slot (A_disp)
  function computeSlotAspect(slotId) {
    let bestAspect = null;
    let maxDuration = -1;

    (window.__amBase || []).forEach((doc) => {
      try {
        const dom = new DOMParser().parseFromString(doc.xml, 'application/xml');
        const shapes = Array.from(dom.getElementsByTagName('shape'));
        shapes.forEach((s) => {
          const fill = s.getAttribute('fillImage') || s.getAttribute('fillVideo') || '';
          if (!fill) return;
          // Cek kecocokan slotId
          const cleanFill = fill.replace(/^amproj:/, '');
          const cleanSlot = (slotId || '').replace(/^amproj:/, '');
          if (fill === slotId || cleanFill === cleanSlot || fill.endsWith(cleanSlot) || cleanSlot.endsWith(cleanFill)) {
            // Ukuran kotak layer (satuan proxy x2)
            let bw = 1080;
            let bh = 1920;
            const sizeProp = Array.from(s.getElementsByTagName('property')).find((p) => p.getAttribute('name') === 'size');
            const sizeStr = s.getAttribute('size') || (sizeProp && sizeProp.getAttribute('value'));
            if (sizeStr) {
              const sp = sizeStr.split(',').map(parseFloat);
              if (sp.length >= 2 && sp[0] > 0 && sp[1] > 0) {
                bw = sp[0] * 2;
                bh = sp[1] * 2;
              }
            }

            // Skala layer
            let sx = 1.0;
            let sy = 1.0;
            const trans = s.getElementsByTagName('transform')[0];
            if (trans) {
              const sc = trans.getElementsByTagName('scale')[0];
              if (sc) {
                const scVal = sc.getAttribute('value');
                if (scVal) {
                  const sp = scVal.split(',').map(parseFloat);
                  if (sp.length >= 2) {
                    sx = Math.abs(sp[0]) || 1.0;
                    sy = Math.abs(sp[1]) || 1.0;
                  }
                } else {
                  // Jika animasi keyframe, cari median scale
                  const kfs = Array.from(sc.getElementsByTagName('kf'));
                  if (kfs.length > 0) {
                    const xs = [];
                    const ys = [];
                    kfs.forEach((kf) => {
                      const v = kf.getAttribute('v');
                      if (v) {
                        const vp = v.split(',').map(parseFloat);
                        if (vp.length >= 2) {
                          xs.push(Math.abs(vp[0]));
                          ys.push(Math.abs(vp[1]));
                        }
                      }
                    });
                    if (xs.length) {
                      xs.sort((a, b) => a - b);
                      ys.sort((a, b) => a - b);
                      sx = xs[Math.floor(xs.length / 2)] || 1.0;
                      sy = ys[Math.floor(ys.length / 2)] || 1.0;
                    }
                  }
                }
              }
            }

            const wDisp = bw * sx;
            const hDisp = bh * sy;
            const aspect = wDisp / hDisp;

            // Durasi layer untuk prioritas
            const start = parseFloat(s.getAttribute('startTime')) || 0;
            const end = parseFloat(s.getAttribute('endTime')) || 0;
            const dur = end - start;
            if (dur > maxDuration) {
              maxDuration = dur;
              bestAspect = aspect;
            }
          }
        });
      } catch (err) {
        console.warn('[computeSlotAspect] parse error', err);
      }
    });

    if (bestAspect && !isNaN(bestAspect) && bestAspect > 0.05 && bestAspect < 20) {
      return bestAspect;
    }

    // Fallback: rasio scene aktif
    const st = window.AM && window.AM.getState ? window.AM.getState() : null;
    if (st && st.width && st.height) {
      return st.width / st.height;
    }
    return 9 / 16;
  }

  // 3. Render Foto Klien ke Kanvas Berasio A_disp (Anti-Gepeng)
  async function renderFramedImage(img, targetDispRatio, settings) {
    const mode = settings.mode || 'auto';
    const panX = settings.panX || 0; // -1 .. 1
    const panY = settings.panY || 0; // -1 .. 1
    const zoom = settings.zoom || 1.0; // 0.5 .. 3.0

    // Dimensi kanvas resolusi tinggi dengan rasio A_disp
    let outW, outH;
    if (targetDispRatio >= 1) {
      outW = 1440;
      outH = Math.max(1, Math.round(1440 / targetDispRatio));
    } else {
      outH = 1440;
      outW = Math.max(1, Math.round(1440 * targetDispRatio));
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;

    // Rasio crop konten foto
    let contentCropRatio = targetDispRatio;
    if (mode === '1:1') contentCropRatio = 1.0;
    else if (mode === '9:16') contentCropRatio = 9 / 16;
    else if (mode === '16:9') contentCropRatio = 16 / 9;
    else if (mode === '4:5') contentCropRatio = 4 / 5;
    else if (mode === '3:4') contentCropRatio = 3 / 4;

    if (mode === 'fit') {
      // Mode Utuh: latar belakang blur foto lembut
      ctx.save();
      const bgScale = Math.max(outW / iw, outH / ih);
      const bgW = iw * bgScale;
      const bgH = ih * bgScale;
      const bgX = (outW - bgW) / 2;
      const bgY = (outH - bgH) / 2;
      ctx.filter = 'blur(30px) brightness(0.45)';
      ctx.drawImage(img, bgX, bgY, bgW, bgH);
      ctx.restore();

      // Gambar utama di tengah (contain) dengan pan & zoom
      const fitScale = Math.min(outW / iw, outH / ih) * zoom;
      const dw = iw * fitScale;
      const dh = ih * fitScale;
      const dx = (outW - dw) / 2 + panX * (outW * 0.4);
      const dy = (outH - dh) / 2 + panY * (outH * 0.4);
      ctx.drawImage(img, dx, dy, dw, dh);
    } else {
      // Mode Cover / Potong Rasio Khusus
      // Hitung area potong sumber dari img
      let cropW, cropH;
      if (iw / ih > contentCropRatio) {
        cropH = ih;
        cropW = ih * contentCropRatio;
      } else {
        cropW = iw;
        cropH = iw / contentCropRatio;
      }

      // Aplikasikan zoom (memperkecil area crop sumber = memperbesar tampilan)
      const effectiveZoom = Math.max(0.2, zoom);
      const zCropW = cropW / effectiveZoom;
      const zCropH = cropH / effectiveZoom;

      // Aplikasikan pan offset
      const maxPanX = Math.max(0, (iw - zCropW) / 2);
      const maxPanY = Math.max(0, (ih - zCropH) / 2);
      const srcX = (iw - zCropW) / 2 - panX * maxPanX;
      const srcY = (ih - zCropH) / 2 - panY * maxPanY;

      // Gambar ke kanvas output
      if (Math.abs(contentCropRatio - targetDispRatio) < 0.01) {
        // Langsung memenuhi seluruh kanvas output
        ctx.drawImage(img, srcX, srcY, zCropW, zCropH, 0, 0, outW, outH);
      } else {
        // Rasio pilihan berbeda dari frame slot (mis. crop 1:1 di slot 9:16):
        // Latar belakang blur foto
        ctx.save();
        const bgScale = Math.max(outW / iw, outH / ih);
        const bgW = iw * bgScale;
        const bgH = ih * bgScale;
        ctx.filter = 'blur(28px) brightness(0.4)';
        ctx.drawImage(img, (outW - bgW) / 2, (outH - bgH) / 2, bgW, bgH);
        ctx.restore();

        // Fit crop shape di tengah
        let destW, destH;
        if (outW / outH > contentCropRatio) {
          destH = outH;
          destW = outH * contentCropRatio;
        } else {
          destW = outW;
          destH = outW / contentCropRatio;
        }
        const destX = (outW - destW) / 2;
        const destY = (outH - destH) / 2;
        ctx.drawImage(img, srcX, srcY, zCropW, zCropH, destX, destY, destW, destH);
      }
    }

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
    return new File([blob], `${Date.now().toString(36)}_framed.jpg`, { type: 'image/jpeg' });
  }

  // 4. Modal Framing Interaktif
  const framingModal = document.getElementById('framingModal');
  const framingCanvas = document.getElementById('framingCanvas');
  const framingCanvasWrap = document.getElementById('framingCanvasWrap');
  const framingSlotName = document.getElementById('framingSlotName');
  const btnFramingClose = document.getElementById('btnFramingClose');
  const btnFramingCancel = document.getElementById('btnFramingCancel');
  const btnFramingApply = document.getElementById('btnFramingApply');
  const framingZoom = document.getElementById('framingZoom');
  const framingZoomVal = document.getElementById('framingZoomVal');
  const framingResetPos = document.getElementById('framingResetPos');
  const framingModeChips = document.getElementById('framingModeChips');

  let activeSlot = null;
  let activeRawFile = null;
  let activeImg = null;
  let activeDispRatio = 9 / 16;
  let currentCropSettings = { mode: 'auto', panX: 0, panY: 0, zoom: 1.0 };
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialPanX = 0;
  let initialPanY = 0;

  function renderFramingPreview() {
    if (!framingCanvas || !activeImg) return;
    const targetDispRatio = activeDispRatio;
    const mode = currentCropSettings.mode;
    const panX = currentCropSettings.panX;
    const panY = currentCropSettings.panY;
    const zoom = currentCropSettings.zoom;

    const wrapW = framingCanvasWrap.clientWidth || 320;
    const wrapH = framingCanvasWrap.clientHeight || 230;

    let pW, pH;
    if (wrapW / wrapH > targetDispRatio) {
      pH = wrapH - 16;
      pW = Math.round(pH * targetDispRatio);
    } else {
      pW = wrapW - 16;
      pH = Math.round(pW / targetDispRatio);
    }

    framingCanvas.width = pW;
    framingCanvas.height = pH;
    const ctx = framingCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;

    const iw = activeImg.naturalWidth || activeImg.width;
    const ih = activeImg.naturalHeight || activeImg.height;

    let contentCropRatio = targetDispRatio;
    if (mode === '1:1') contentCropRatio = 1.0;
    else if (mode === '9:16') contentCropRatio = 9 / 16;
    else if (mode === '16:9') contentCropRatio = 16 / 9;
    else if (mode === '4:5') contentCropRatio = 4 / 5;
    else if (mode === '3:4') contentCropRatio = 3 / 4;

    if (mode === 'fit') {
      ctx.save();
      const bgScale = Math.max(pW / iw, pH / ih);
      ctx.filter = 'blur(16px) brightness(0.45)';
      ctx.drawImage(activeImg, (pW - iw * bgScale) / 2, (pH - ih * bgScale) / 2, iw * bgScale, ih * bgScale);
      ctx.restore();

      const fitScale = Math.min(pW / iw, pH / ih) * zoom;
      const dw = iw * fitScale;
      const dh = ih * fitScale;
      const dx = (pW - dw) / 2 + panX * (pW * 0.4);
      const dy = (pH - dh) / 2 + panY * (pH * 0.4);
      ctx.drawImage(activeImg, dx, dy, dw, dh);
    } else {
      let cropW, cropH;
      if (iw / ih > contentCropRatio) {
        cropH = ih;
        cropW = ih * contentCropRatio;
      } else {
        cropW = iw;
        cropH = iw / contentCropRatio;
      }

      const effectiveZoom = Math.max(0.2, zoom);
      const zCropW = cropW / effectiveZoom;
      const zCropH = cropH / effectiveZoom;

      const maxPanX = Math.max(0, (iw - zCropW) / 2);
      const maxPanY = Math.max(0, (ih - zCropH) / 2);
      const srcX = (iw - zCropW) / 2 - panX * maxPanX;
      const srcY = (ih - zCropH) / 2 - panY * maxPanY;

      if (Math.abs(contentCropRatio - targetDispRatio) < 0.01) {
        ctx.drawImage(activeImg, srcX, srcY, zCropW, zCropH, 0, 0, pW, pH);
      } else {
        ctx.save();
        const bgScale = Math.max(pW / iw, pH / ih);
        ctx.filter = 'blur(16px) brightness(0.4)';
        ctx.drawImage(activeImg, (pW - iw * bgScale) / 2, (pH - ih * bgScale) / 2, iw * bgScale, ih * bgScale);
        ctx.restore();

        let destW, destH;
        if (pW / pH > contentCropRatio) {
          destH = pH;
          destW = pH * contentCropRatio;
        } else {
          destW = pW;
          destH = pW / contentCropRatio;
        }
        ctx.drawImage(activeImg, srcX, srcY, zCropW, zCropH, (pW - destW) / 2, (pH - destH) / 2, destW, destH);
      }
    }
  }

  function openFramingModal(slot, rawFile, savedSettings) {
    if (!framingModal) return;
    activeSlot = slot;
    activeRawFile = rawFile;
    activeDispRatio = computeSlotAspect(slot.id);

    currentCropSettings = Object.assign({ mode: 'auto', panX: 0, panY: 0, zoom: 1.0 }, savedSettings || {});

    if (framingSlotName) {
      const idx = (window.AM && window.AM.getMediaSlots ? window.AM.getMediaSlots() : []).indexOf(slot);
      framingSlotName.textContent = `Slot ${idx >= 0 ? idx + 1 : ''} (Frame: ${activeDispRatio >= 0.99 && activeDispRatio <= 1.01 ? '1:1' : activeDispRatio < 0.7 ? '9:16' : activeDispRatio.toFixed(2)})`;
    }

    if (framingZoom) framingZoom.value = String(currentCropSettings.zoom);
    if (framingZoomVal) framingZoomVal.textContent = `${currentCropSettings.zoom.toFixed(2)}x`;

    if (framingModeChips) {
      framingModeChips.querySelectorAll('.chip').forEach((c) => {
        c.classList.toggle('active', c.dataset.mode === currentCropSettings.mode);
      });
    }

    const img = new Image();
    const url = URL.createObjectURL(rawFile);
    img.onload = () => {
      URL.revokeObjectURL(url);
      activeImg = img;
      framingModal.style.display = 'flex';
      renderFramingPreview();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert('Gagal membaca gambar untuk diposisikan.');
    };
    img.src = url;
  }

  function closeFramingModal() {
    if (framingModal) framingModal.style.display = 'none';
    activeSlot = null;
    activeRawFile = null;
    activeImg = null;
  }

  btnFramingClose?.addEventListener('click', closeFramingModal);
  btnFramingCancel?.addEventListener('click', closeFramingModal);

  // Drag pan pointer event
  if (framingCanvasWrap) {
    framingCanvasWrap.addEventListener('pointerdown', (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      initialPanX = currentCropSettings.panX;
      initialPanY = currentCropSettings.panY;
      framingCanvasWrap.setPointerCapture(e.pointerId);
    });

    framingCanvasWrap.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = (e.clientX - dragStartX) / (framingCanvas.width * 0.5);
      const dy = (e.clientY - dragStartY) / (framingCanvas.height * 0.5);
      currentCropSettings.panX = Math.max(-1.5, Math.min(1.5, initialPanX + dx));
      currentCropSettings.panY = Math.max(-1.5, Math.min(1.5, initialPanY + dy));
      renderFramingPreview();
    });

    const stopDrag = (e) => {
      if (isDragging) {
        isDragging = false;
        try { framingCanvasWrap.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    framingCanvasWrap.addEventListener('pointerup', stopDrag);
    framingCanvasWrap.addEventListener('pointercancel', stopDrag);
  }

  // Zoom range input
  framingZoom?.addEventListener('input', () => {
    currentCropSettings.zoom = parseFloat(framingZoom.value) || 1.0;
    if (framingZoomVal) framingZoomVal.textContent = `${currentCropSettings.zoom.toFixed(2)}x`;
    renderFramingPreview();
  });

  // Reset Posisi
  framingResetPos?.addEventListener('click', () => {
    currentCropSettings.panX = 0;
    currentCropSettings.panY = 0;
    currentCropSettings.zoom = 1.0;
    if (framingZoom) framingZoom.value = '1';
    if (framingZoomVal) framingZoomVal.textContent = '1.00x';
    renderFramingPreview();
  });

  // Mode Chips
  framingModeChips?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    framingModeChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    currentCropSettings.mode = chip.dataset.mode;
    renderFramingPreview();
  });

  // Tombol Pasang ke Slot
  btnFramingApply?.addEventListener('click', async () => {
    if (!activeSlot || !activeImg || !activeRawFile) return;
    btnFramingApply.disabled = true;
    const prevText = btnFramingApply.querySelector('span')?.textContent;
    if (btnFramingApply.querySelector('span')) btnFramingApply.querySelector('span').textContent = 'Memproses...';

    try {
      const processed = await renderFramedImage(activeImg, activeDispRatio, currentCropSettings);
      await window.AM.applyMedia(activeSlot.id, processed);

      window.__slotFiles = Object.assign(window.__slotFiles || {}, { [activeSlot.id]: processed });
      window.__slotRawFiles = Object.assign(window.__slotRawFiles || {}, {
        [activeSlot.id]: {
          rawFile: activeRawFile,
          settings: Object.assign({}, currentCropSettings),
          img: activeImg
        }
      });
      const fileName = activeRawFile ? activeRawFile.name : 'Foto';
      window.__slotPicked = Object.assign(window.__slotPicked || {}, { [activeSlot.id]: fileName });

      closeFramingModal();
      if (typeof window.__tidySlots === 'function') window.__tidySlots();

      const slotSwapState = document.getElementById('slotSwapState');
      if (slotSwapState) {
        slotSwapState.style.display = 'block';
        slotSwapState.style.color = '#34d399';
        slotSwapState.textContent = `Terpasang: ${fileName} (Anti-gepeng)`;
      }
    } catch (err) {
      console.error('[Framing Apply Error]', err);
      alert(`Gagal memasang foto: ${err.message}`);
    } finally {
      btnFramingApply.disabled = false;
      if (btnFramingApply.querySelector('span')) btnFramingApply.querySelector('span').textContent = prevText || 'Pasang ke Slot';
    }
  });

  // 5. Kartu Rasio Preset
  const presetRatioChips = document.getElementById('presetRatioChips');
  const btnRatioApply = document.getElementById('btnRatioApply');
  const btnRatioRevert = document.getElementById('btnRatioRevert');
  const ratioState = document.getElementById('ratioState');
  const currentRatioBadge = document.getElementById('currentRatioBadge');

  const showRatioState = (msg, color) => {
    if (!ratioState) return;
    ratioState.style.display = msg ? 'block' : 'none';
    ratioState.style.color = color || '';
    ratioState.textContent = msg || '';
  };

  const isRatioDirty = () => {
    const cur = JSON.stringify({ ratio: pendingRatio, mode: pendingFitMode });
    return cur !== appliedRatioConfig;
  };

  const hasAppliedRatio = () => {
    const cur = JSON.parse(appliedRatioConfig);
    return cur.ratio !== 'original';
  };

  const refreshRatioButtons = () => {
    if (!btnRatioApply || !btnRatioRevert) return;
    const dirty = isRatioDirty();
    btnRatioApply.disabled = !dirty;
    btnRatioRevert.disabled = !(dirty || hasAppliedRatio());
    const lbl = btnRatioRevert.querySelector('span');
    if (lbl) lbl.textContent = dirty ? 'Batalkan pilihan' : 'Kembalikan rasio asli';
  };

  presetRatioChips?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    presetRatioChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    pendingRatio = chip.dataset.ratio || 'original';
    refreshRatioButtons();
    showRatioState('');
  });

  document.querySelectorAll('input[name="ratioFitMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      pendingFitMode = radio.value;
      refreshRatioButtons();
      showRatioState('');
    });
  });

  btnRatioApply?.addEventListener('click', async () => {
    if (typeof window.__applyPresetRatio === 'function') {
      await window.__applyPresetRatio({ ratio: pendingRatio, mode: pendingFitMode });
      appliedRatioConfig = JSON.stringify({ ratio: pendingRatio, mode: pendingFitMode });
      window.__presetRatioConfig = JSON.parse(appliedRatioConfig);
      if (currentRatioBadge) currentRatioBadge.textContent = pendingRatio === 'original' ? 'Asli' : pendingRatio;
      refreshRatioButtons();
      showRatioState(`Selesai: Rasio preset diubah ke ${pendingRatio} (${pendingFitMode === 'fit' ? 'Pas' : 'Penuh'}).`, '#34d399');
    }
  });

  btnRatioRevert?.addEventListener('click', async () => {
    if (isRatioDirty()) {
      const cur = JSON.parse(appliedRatioConfig);
      pendingRatio = cur.ratio;
      pendingFitMode = cur.mode;
      presetRatioChips?.querySelectorAll('.chip').forEach((c) => {
        c.classList.toggle('active', c.dataset.ratio === pendingRatio);
      });
      const rad = document.querySelector(`input[name="ratioFitMode"][value="${pendingFitMode}"]`);
      if (rad) rad.checked = true;
      refreshRatioButtons();
      showRatioState('Pilihan yang belum diterapkan dibatalkan.', '#cbd5e1');
    } else {
      pendingRatio = 'original';
      pendingFitMode = 'fit';
      presetRatioChips?.querySelectorAll('.chip').forEach((c) => {
        c.classList.toggle('active', c.dataset.ratio === 'original');
      });
      const rad = document.querySelector('input[name="ratioFitMode"][value="fit"]');
      if (rad) rad.checked = true;

      if (typeof window.__applyPresetRatio === 'function') {
        await window.__applyPresetRatio({ ratio: 'original', mode: 'fit' });
        appliedRatioConfig = JSON.stringify({ ratio: 'original', mode: 'fit' });
        window.__presetRatioConfig = JSON.parse(appliedRatioConfig);
        if (currentRatioBadge) currentRatioBadge.textContent = 'Asli';
        refreshRatioButtons();
        showRatioState('Rasio preset dikembalikan ke aslinya.', '#34d399');
      }
    }
  });

  // Ekspor API internal modul
  window.__openFramingModal = openFramingModal;
  window.__transformPresetXml = transformPresetXml;
  window.__computeSlotAspect = computeSlotAspect;
  window.__renderFramedImage = renderFramedImage;
  window.__refreshRatioButtons = refreshRatioButtons;
})();
