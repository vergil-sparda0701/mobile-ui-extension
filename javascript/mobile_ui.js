/**
 * SD Mobile UI — v10.0 + Fix CN-reForge (v26 patch)
 * FIX v26: Regional Prompter — orden de args DEFINITIVO según README oficial.
 *   - Vuelve al orden estándar: [active,debug,calcmode,splitmode,sub,sub,aratios,bratios,flip,usebase,usecom,dmode,turbo,...]
 *   - Split "Columns"→"Vertical", "Rows"→"Horizontal" (valores internos de la API)
 *   - Migración automática de localStorage corrupto de versiones anteriores
 *   - usencom (Use common negative prompt) eliminado del payload (no existe en la versión estándar)
 * Mejoras: persistencia localStorage, Stop generation, lightbox fullscreen,
 *          prompt ideas expandido (50+), validación resolución múltiplo de 8,
 *          indicador de carga de modelo, export parámetros, ADetailer models extendidos,
 *          i18n centralizado, refactor render por secciones, Extra mejorado.
 *
 * FIX CN-reForge (v19 → v21):
 *   - [v21] CAUSA RAÍZ DEFINITIVA: reForge llama try_crop_image_with_a1111_mask()
 *     con el preprocessor como argumento. Si enabled=true pero image=null,
 *     el preprocessor "none" no tiene .corp_image_with_a1111_mask_when_in_img2img_inpaint_tab
 *     → AttributeError. SOLUCIÓN: solo enabled=true si la unidad tiene modelo E imagen.
 *     Sin imagen → stub disabled. La UI muestra aviso al usuario.
 *   - control_mode enviado como entero (0/1/2) — más robusto que strings.
 *   - module siempre se normaliza a lowercase → "none" (minúsculas).
 *     "None" (mayúscula) o "bypass" no existen en el registry de reForge → NoneType crash.
 *     reForge's get_preprocessor() es case-sensitive: solo registra "none" en minúsculas.
 *   - Siempre se envían las 3 unidades CN (incluso las deshabilitadas como stubs)
 *     → evita KeyError: 0 en process_before_every_sampling / postprocess_batch_list.
 *   - threshold_a / threshold_b: ya no se envía -1; se usa 64 como valor seguro
 *     cuando no hay umbral definido.
 */
(function () {
  "use strict";

  /* ══ i18n ════════════════════════════════════ */
  const T = {
    generate: "⚡ Generar",
    generating: "Generando…",
    stop: "⏹ Detener",
    noPrompt: "⚠️ Escribe un prompt",
    loadingModel: "⏳ Cargando modelo…",
    modelLoaded: "✅ Modelo listo",
    modelError: "No se pudo cambiar el modelo",
    maxLoras: "Máximo 4 LoRAs",
    onlyImages: "⚠️ Solo imágenes",
    copied: "📋 ¡Copiado!",
    noTriggers: "ℹ️ Sin trigger words para este LoRA",
    reloading: "🔄 Recargando…",
    imgLoaded: "🖼️ Imagen cargada — Unit ",
    imgError: "❌ Error al leer imagen",
    resWarn: "⚠️ Ancho/alto deben ser múltiplos de 8 (ajustados automáticamente)",
    paramsCopied: "📋 Parámetros copiados",
    stopped: "⏹ Generación detenida",
    stopError: "No se pudo detener la generación",
    slowWarning: "⏳ Upscale/ADetailer activo — puede tardar varios minutos en gradio.live",
  };

  /* ══ ZOOM ════════════════════════════════════ */
  function getBodyZoom() {
    try {
      const bz = parseFloat(getComputedStyle(document.body).zoom) || 1;
      const hz = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const bt = getComputedStyle(document.body).transform;
      let bs = 1;
      if (bt && bt !== "none") {
        const m = bt.match(/matrix\(([^,]+)/);
        if (m) bs = parseFloat(m[1]) || 1;
      }
      return bz * hz * bs;
    } catch(e) { return 1; }
  }
  function getVW(){ return window.visualViewport ? window.visualViewport.width  : window.innerWidth; }
  function getVH(){ return window.visualViewport ? window.visualViewport.height : window.innerHeight; }
  function applySize() {
    const ov = $("muiOv"); if (!ov) return;
    const zoom = getBodyZoom();
    ov.style.setProperty("zoom",   (1 / zoom).toFixed(6), "important");
    ov.style.setProperty("width",  Math.ceil(getVW() * zoom) + "px", "important");
    ov.style.setProperty("height", Math.ceil(getVH() * zoom) + "px", "important");
    ov.style.setProperty("max-height", Math.ceil(getVH() * zoom) + "px", "important");
  }

  /* ══ DEVICE ══════════════════════════════════ */
  const MOBILE = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i
    .test(navigator.userAgent) || window.innerWidth <= 820;

  /* ══ STATE ═══════════════════════════════════ */
  const S = {
    tab: "txt2img",
    prompt: "",
    neg: "worst quality, low quality, lowres",
    ar: "portrait",
    cw: 896, ch: 1152,
    sampler: "Euler a", scheduler: "Automatic",
    steps: 25, cfg: 6, seed: "",
    count: 1,

    // ── Multi-LoRA ─────────────────────────
    loras_active: [],

    // ── Img2Img ────────────────────────────
    i2iImageB64: null,          // FIX BUG-01
    i2iPrompt: "",
    i2iNeg: "",
    i2iDn: 0.55,
    i2iResizeMode: "Just Resize",

    // ── Upscale ────────────────────────────
    upscale: false, upscaler: "R-ESRGAN 4x+", upscaleX: 2, upscaleDn: 0.4,

    // ── ADetailer ──────────────────────────
    adetailer: false,
    adTab: 0,
    adSlots: [
      { enabled: true,  model: "face_yolov8n.pt",         conf: 0.3, dn: 0.4, prompt: "", neg: "" },
      { enabled: false, model: "hand_yolov8n.pt",          conf: 0.3, dn: 0.4, prompt: "", neg: "" },
      { enabled: false, model: "person_yolov8n-seg.pt",    conf: 0.3, dn: 0.4, prompt: "", neg: "" },
      { enabled: false, model: "face_yolov8s.pt",          conf: 0.3, dn: 0.4, prompt: "", neg: "" },
    ],

    // ── Regional Prompter ──────────────────
    rp: false,
    rpMode: "Attention",         // Generation Mode: Attention / Latent
    rpCalcMode: "Matrix",        // Calc Mode: Matrix / Mask / Prompt
    rpBase: "0.2",               // Base Ratio (string para compatibilidad con API)
    rpSplitting: "Columns",      // Main Splitting: Columns / Rows / Random
    rpRatio: "1,1",              // Divide Ratio
    rpFlip: false,               // Flip "," and ";"
    rpBasePrompt: false,         // Use base prompt
    rpCommonPrompt: false,       // Use common prompt
    rpComNegPrompt: false,       // Use common negative prompt
    rpTemplate: "",              // Prompt por región (texto con BREAK)

    // ── Layer Diffusion ────────────────────
    layerDiff: false,
    layerDiffMode: "Background Only",   // FIX BUG-03: modos disponibles
    layerDiffWeight: 1.0,

    // ── ControlNet ─────────────────────────
    cnUnits: [
      { enabled: false, imageB64: null, preprocessedB64: null, preprocessor: "none", model: "none",
        weight: 1.0, startStep: 0, endStep: 1, mode: "Balanced", resize: "Crop and Resize",
        pixelPerfect: false, lowVram: false,
        detectRes: 512, threshA: -1, threshB: -1, detecting: false },
      { enabled: false, imageB64: null, preprocessedB64: null, preprocessor: "none", model: "none",
        weight: 1.0, startStep: 0, endStep: 1, mode: "Balanced", resize: "Crop and Resize",
        pixelPerfect: false, lowVram: false,
        detectRes: 512, threshA: -1, threshB: -1, detecting: false },
      { enabled: false, imageB64: null, preprocessedB64: null, preprocessor: "none", model: "none",
        weight: 1.0, startStep: 0, endStep: 1, mode: "Balanced", resize: "Crop and Resize",
        pixelPerfect: false, lowVram: false,
        detectRes: 512, threshA: -1, threshB: -1, detecting: false },
    ],
    cnTab: 0,
    cnModels: [],
    cnPreprocessors: [],

    // ── Model/data ─────────────────────────
    model: "",
    models: [], loras: [], samplers: [], schedulers: [], upscalers: [],
    // FIX BUG-06: lista extendida de modelos ADetailer
    adModels: [
      "face_yolov8n.pt","face_yolov8s.pt","face_yolov9c.pt",
      "hand_yolov8n.pt","hand_yolov9c.pt",
      "person_yolov8n-seg.pt","person_yolov9c-seg.pt",
      "mediapipe_face_full","mediapipe_face_short","mediapipe_face_mesh",
    ],

    // ── Gen state ──────────────────────────
    busy: false, progress: 0, eta: 0, liveImg: null,
    history: [],
    _pt: null,
    _civitai: {},
    _dataLoaded: false,          // MEJORA-05: flag para no recargar innecesariamente
    _dataTs: 0,
    _modelChanging: false,       // MEJORA-08: flag de modelo en carga
    _cnResizeModeInt:    false,
    _cnResizeModeProbed: false,
  };

  const AR = {
    portrait:  { lbl:"2:3",   icon:"▯", sub:"768×1152",  w:768,  h:1152 },
    landscape: { lbl:"3:2",   icon:"▭", sub:"1152×768",  w:1152, h:768  },
    square:    { lbl:"1:1",   icon:"□", sub:"1024×1024", w:1024, h:1024 },
    custom:    { lbl:"custom",icon:"⊞", sub:"custom",    w:null, h:null  },
  };

  /* ══ UTILS ═══════════════════════════════════ */
  const esc   = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const escA  = s => String(s||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
  const $     = id => document.getElementById(id);
  const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
  const uid   = () => Math.random().toString(36).slice(2,9);
  const nowTs = () => new Date().toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"});

  // MEJORA-09: ajusta a múltiplo de 8
  function snap8(v){ return Math.max(64, Math.round(parseInt(v)||512) & ~7); }

  /* ══ PERSISTENCIA ════════════════════════════
     MEJORA-03: guarda y restaura estado en localStorage
  ═════════════════════════════════════════════ */
  const PERSIST_KEYS = ["prompt","neg","ar","cw","ch","sampler","scheduler","steps","cfg","seed",
    "count","loras_active","upscale","upscaler","upscaleX","upscaleDn",
    "adetailer","adTab","adSlots","rp","rpMode","rpCalcMode","rpBase","rpSplitting","rpRatio",
    "rpFlip","rpBasePrompt","rpCommonPrompt","rpComNegPrompt","rpTemplate",
    "layerDiff","layerDiffMode","layerDiffWeight",
    "model","i2iPrompt","i2iNeg","i2iDn","i2iResizeMode"];

  function saveState() {
    try {
      const snap = {};
      PERSIST_KEYS.forEach(k => { snap[k] = S[k]; });
      localStorage.setItem("mui_state_v10", JSON.stringify(snap));
    } catch(e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem("mui_state_v10");
      if (!raw) return;
      const snap = JSON.parse(raw);
      PERSIST_KEYS.forEach(k => { if (snap[k] !== undefined) S[k] = snap[k]; });

      // ── Migración v26: sanear campos RP que podrían ser corruptos ──────────
      // Si rpCalcMode no es string, resetear al default
      if (typeof S.rpCalcMode !== "string" || !["Matrix","Mask","Prompt"].includes(S.rpCalcMode)) {
        S.rpCalcMode = "Matrix";
      }
      // Si rpMode no es "Attention" ni "Latent", resetear
      if (typeof S.rpMode !== "string" || !["Attention","Latent"].includes(S.rpMode)) {
        S.rpMode = "Attention";
      }
      // Si rpSplitting no es string válido, resetear
      if (typeof S.rpSplitting !== "string" || !["Columns","Rows","Random"].includes(S.rpSplitting)) {
        S.rpSplitting = "Columns";
      }
      // rpBase debe ser string o número, nunca bool
      if (typeof S.rpBase === "boolean") S.rpBase = "0.2";
      // rpFlip/rpBasePrompt/rpCommonPrompt/rpComNegPrompt deben ser bool
      ["rpFlip","rpBasePrompt","rpCommonPrompt","rpComNegPrompt"].forEach(k => {
        if (typeof S[k] !== "boolean") S[k] = false;
      });
      // ─────────────────────────────────────────────────────────────────────
    } catch(e) {}
  }

  // Auto-save en cada cambio de estado que importa
  let _saveTimer;
  function scheduleSave() { clearTimeout(_saveTimer); _saveTimer = setTimeout(saveState, 800); }

  /* ══ PREVIEW URLS ════════════════════════════ */
  const BASE = window.location.origin;
  function previewUrls(fp) {
    if (!fp) return [];
    // FIX BUG-07: usar encodeURIComponent para rutas con espacios/especiales
    const base = fp.replace(/\.[^/.]+$/, "");
    const urls = [];
    [".preview.png",".preview.jpg",".png",".jpg"].forEach(e =>
      urls.push(BASE + "/sd_extra_networks/thumb?filename=" + encodeURIComponent(base + e))
    );
    [".preview.png",".preview.jpg"].forEach(e =>
      urls.push(BASE + "/file=" + encodeURIComponent(base + e))
    );
    return urls;
  }
  window.muiImgErr = function(img, urlsJson) {
    try {
      const urls = JSON.parse(urlsJson);
      const cur  = urls.indexOf(img.src);
      if (cur >= 0 && cur < urls.length - 1) { img.src = urls[cur + 1]; }
      else {
        const p = img.parentNode;
        if (p) p.innerHTML = '<span style="font-size:20px">' + (p.dataset.fb||"🎨") + '</span>';
      }
    } catch(e) {}
  };
  function imgTag(urls, fb) {
    if (!urls || !urls.length) return '<span style="font-size:20px">' + fb + '</span>';
    const j = esc(JSON.stringify(urls));
    return `<img src="${esc(urls[0])}" loading="lazy"
      style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit"
      onerror="muiImgErr(this,'${j}')">`;
  }

  /* ══ HTTP ════════════════════════════════════ */
  const H = () => ({
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
    "User-Agent": "sd-mobile/10",
  });

  async function GET(p) {
    try { const r = await fetch(BASE+p,{headers:H(),credentials:"include"}); return r.ok?r.json():null; }
    catch { return null; }
  }
  async function POST(p, b, timeoutMs) {
    const ms = timeoutMs || 12 * 60 * 1000;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(BASE+p, {
        method: "POST", headers: H(), credentials: "include",
        body: JSON.stringify(b), signal: ctrl.signal,
      });
      clearTimeout(tid);
      if (!r.ok) {
        if (r.status === 504) throw new Error("HTTP 504 — El servidor tardó demasiado. Reduce los steps o desactiva Upscale/ADetailer múltiple.");
        throw new Error("HTTP " + r.status);
      }
      return r.json();
    } catch(e) {
      clearTimeout(tid);
      if (e.name === "AbortError") throw new Error("Timeout (12 min) — generación cancelada");
      throw e;
    }
  }

  /* ══ TRIGGER WORDS ═══════════════════════════
     FIX BUG-07: rutas con encodeURIComponent para sidecars
  ═════════════════════════════════════════════ */
  async function fetchTriggers(loraObj) {
    const key = loraObj.n || "";
    if (S._civitai[key] !== undefined) return S._civitai[key];

    function parseTW(d) {
      if (!d || typeof d !== "object") return "";
      const raw = d["activation text"] || d["activation_text"]
        || d.trainedWords || d.triggerWords || d.activation_text
        || d["trained words"] || d["trigger_words"] || "";
      const tw = Array.isArray(raw) ? raw.join(", ") : String(raw || "");
      return tw.trim();
    }

    const path = loraObj.path || "";
    const base = path ? path.replace(/\.[^/.]+$/, "") : "";

    // 1. .json sidecar — FIX BUG-07: encodeURIComponent para paths con espacios
    if (base) {
      try {
        const r = await fetch(BASE + "/file=" + encodeURIComponent(base + ".json"),
          { headers: H(), credentials: "include" });
        if (r.ok) {
          const d = await r.json();
          const tw = parseTW(d);
          if (tw) { S._civitai[key] = tw; return tw; }
        }
      } catch(e) {}
    }

    // 2. Forge /sd_extra_networks/metadata
    const shortName = key.replace(/\.[^/.]+$/, "");
    for (const nm of [shortName, key]) {
      try {
        const r = await fetch(
          BASE + "/sd_extra_networks/metadata?extra_networks_tabname=lora&item_name=" + encodeURIComponent(nm),
          { headers: H(), credentials: "include" }
        );
        if (r.ok) {
          const txt = await r.text();
          if (txt && txt !== "{}" && txt !== "null" && txt.trim()) {
            try {
              const tw = parseTW(JSON.parse(txt));
              if (tw) { S._civitai[key] = tw; return tw; }
            } catch(e) {}
          }
        }
      } catch(e) {}
    }

    if (!base) { S._civitai[key] = ""; return ""; }

    // 3. .civitai.info sidecar
    try {
      const r = await fetch(BASE + "/file=" + encodeURIComponent(base + ".civitai.info"),
        { headers: H(), credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        const tw = parseTW(d);
        if (tw) { S._civitai[key] = tw; return tw; }
      }
    } catch(e) {}

    // 4. .txt sidecar
    try {
      const r = await fetch(BASE + "/file=" + encodeURIComponent(base + ".txt"),
        { headers: H(), credentials: "include" });
      if (r.ok) {
        const t = (await r.text()).trim();
        if (t && t.length < 500) { S._civitai[key] = t; return t; }
      }
    } catch(e) {}

    S._civitai[key] = "";
    return "";
  }

  /* ══ LOAD DATA ═══════════════════════════════
     MEJORA-05: no recarga si los datos tienen menos de 5 minutos
  ═════════════════════════════════════════════ */
  async function loadData(force) {
    const AGE = 5 * 60 * 1000;
    if (!force && S._dataLoaded && (Date.now() - S._dataTs) < AGE) {
      rerender(); return;
    }
    notify("🔄 Cargando datos…");
    const [md, opts, ld, sd, ud, schd, cnm, cnp] = await Promise.all([
      GET("/sdapi/v1/sd-models"), GET("/sdapi/v1/options"),
      GET("/sdapi/v1/loras"), GET("/sdapi/v1/samplers"),
      GET("/sdapi/v1/upscalers"), GET("/sdapi/v1/schedulers"),
      GET("/controlnet/model_list"),
      GET("/controlnet/module_list"),
    ]);
    if (md?.length) S.models = md.map(m => ({ t:m.title||m.name, n:m.model_name||m.title, path:m.filename||"", hash:m.hash||"", preview:previewUrls(m.filename||"") }));
    // FIX BUG-06: solo sobreescribe si no hay modelo guardado o si el modelo guardado no está en la lista
    const modelInList = S.models.some(m => m.t === S.model);
    if (opts?.sd_model_checkpoint && !modelInList) S.model = opts.sd_model_checkpoint;
    else if (!S.model && S.models.length) S.model = S.models[0].t;
    if (ld) S.loras = ld.map(l => ({ n:l.name, a:l.alias||l.name, path:l.path||"", preview:previewUrls(l.path||""), triggers:null }));
    if (sd?.length) S.samplers = sd.map(s=>s.name);
    else S.samplers = ["Euler a","Euler","DPM++ 2M","DPM++ 2M Karras","DPM++ 2M SDE","DPM++ 2M SDE Karras","DPM++ SDE Karras","DPM++ 3M SDE Karras","DPM++ 3M SDE Exponential","DPM2","DPM2 Karras","DDIM","DDPM","PLMS","UniPC","LMS","LMS Karras","Heun","Restart","TCD","LCM"];
    if (schd?.length) S.schedulers = schd.map(s=>s.name||s.label||s);
    else S.schedulers = ["Automatic","Karras","Exponential","SGM Uniform","Simple","Normal","DDIM Uniform"];
    if (ud?.length) S.upscalers = ud.map(u=>u.name).filter(n=>n&&n!=="None");
    else S.upscalers = ["Lanczos","Nearest","ESRGAN_4x","R-ESRGAN 4x+","R-ESRGAN 4x+ Anime6B","SwinIR 4x","LDSR","ScuNET GAN"];
    if (cnm?.model_list?.length) S.cnModels = ["none", ...cnm.model_list];
    else S.cnModels = ["none"];
    if (cnp?.module_list?.length) S.cnPreprocessors = ["none", ...cnp.module_list];
    else S.cnPreprocessors = ["none","canny","depth","depth_midas","depth_zoe","hed","lineart","lineart_anime",
      "mediapipe_face","mlsd","normal_map","openpose","openpose_face","openpose_faceonly",
      "openpose_full","openpose_hand","scribble_hed","scribble_pidinet","seg_ofade20k",
      "shuffle","softedge_hed","softedge_pidinet","tile_colorfix","tile_resample",
      "ip-adapter","ip-adapter_face_id","invert"];
    notify("✅ "+S.models.length+" modelos · "+S.loras.length+" LoRAs · "+S.cnModels.length+" CN");
    S._dataLoaded = true;
    S._dataTs = Date.now();
    probeCNResizeMode();
    rerender();
  }

  async function probeCNResizeMode() {
    if (S._cnResizeModeProbed) return;
    S._cnResizeModeProbed = true;
    try {
      const ver = await GET("/controlnet/version");
      if (ver && ver.version) {
        const v = parseFloat(String(ver.version));
        S._cnResizeModeInt = v < 1.1;
        return;
      }
    } catch(e) {}
    S._cnResizeModeInt = false;
  }

  /* ══ GENERATE — txt2img ══════════════════════ */
  async function generate() {
    if (S.busy) return;
    if (!S.prompt.trim()) { notify(T.noPrompt,true); return; }
    // Block if CN is enabled+has model+has image but preprocessor not yet run
    // reForge CANNOT run preprocessors internally from API — must be pre-processed
    const cnNeedsPrep = S.cnUnits.filter(u =>
      u.enabled && u.model && u.model !== "none" && u.imageB64
      && !u.preprocessedB64
      && !CN_PASSTHROUGH.has(u.preprocessor) && u.preprocessor !== "none"
    );
    if (cnNeedsPrep.length) {
      notify("⚠️ ControlNet: corre el preprocesador (▶) antes de generar", true);
      return;
    }
    // Block if CN enabled+model but no image at all
    const cnEnabledNoImg = S.cnUnits.filter(u => u.enabled && u.model && u.model !== "none" && !u.imageB64 && !u.preprocessedB64);
    if (cnEnabledNoImg.length) {
      notify("⚠️ ControlNet activo pero sin imagen — sube una imagen al CN o desactívalo", true);
      return;
    }
    const ar=AR[S.ar];
    // FIX BUG-09 / MEJORA-09: validar y snap a múltiplo de 8
    let w = snap8(ar.w||S.cw);
    let h = snap8(ar.h||S.ch);
    if (S.ar === "custom" && (S.cw % 8 !== 0 || S.ch % 8 !== 0)) {
      notify(T.resWarn);
      S.cw = w; S.ch = h;
    }
    let prompt = S.prompt;
    S.loras_active.forEach(l => { if (l.n) prompt += ", <lora:"+l.n+":"+l.w+">"; });
    const count=parseInt(S.count)||1;
    const jobId=uid();
    const activeLoraSummary = S.loras_active.map(l=>l.n+"("+l.w+")").join(", ") || "—";
    const params={
      prompt, neg:S.neg, w, h, sampler:S.sampler, scheduler:S.scheduler,
      steps:S.steps, cfg:S.cfg, seed:S.seed||"−1", count,
      model:S.model, loras:activeLoraSummary,
      upscale:S.upscale, upscaler:S.upscaler, upscaleX:S.upscaleX,
      adetailer:S.adetailer, adSlots: S.adSlots.filter(s=>s.enabled).map(s=>s.model),
      rp:S.rp, rpMode:S.rpMode, rpSplitting:S.rpSplitting, ts:nowTs(),
      layerDiff:S.layerDiff,
    };
    S.busy=true; S.progress=0; S.eta=0; S.liveImg=null;
    S.history.unshift({id:jobId,params,images:[],status:"generating",progress:0});
    updateGenBtn(); mui.tab("tasks");

    if ((S.upscale || (S.adetailer && S.adSlots.filter(s=>s.enabled).length > 1))
        && /gradio\.live|ngrok/i.test(window.location.hostname)) {
      notify(T.slowWarning);
    }

    S._pt=setInterval(async()=>{
      const p=await GET("/sdapi/v1/progress?skip_current_image=false");
      if(!p) return;
      const pct=Math.round((p.progress||0)*100);
      S.progress=pct; S.eta=Math.round(p.eta_relative||0);
      if(p.current_image) S.liveImg="data:image/png;base64,"+p.current_image;
      const job=S.history.find(j=>j.id===jobId);
      if(job){job.progress=pct;job.eta=S.eta;}
      updateTaskCard(jobId); updateGenBtn();
    },900);

    const payload={
      prompt, negative_prompt:S.neg, width:w, height:h,
      sampler_name:S.sampler,
      scheduler:S.scheduler!=="Automatic"?S.scheduler:undefined,
      steps:S.steps, cfg_scale:S.cfg,
      seed:S.seed?parseInt(S.seed):-1,
      n_iter:1, batch_size:count,
      alwayson_scripts:{},
    };

    // ADetailer
    if (S.adetailer) {
      const enabledSlots = S.adSlots.filter(s => s.enabled);
      if (enabledSlots.length) {
        payload.alwayson_scripts["ADetailer"] = {
          args: [
            true,
            ...enabledSlots.map(s => ({
              ad_model: s.model,
              ad_confidence: s.conf,
              ad_denoising_strength: s.dn,
              ad_prompt: s.prompt || "",
              ad_negative_prompt: s.neg || "",
              ad_inpaint_width: 512,
              ad_inpaint_height: 512,
              ad_use_inpaint_width_height: false,
            }))
          ]
        };
      }
    }

    // Regional Prompter — ORDEN CORRECTO para reForge (verificado por traceback)
    // El error 'argument of type bool is not iterable' en rp.py line 574 `if "Att" in calcmode`
    // Regional Prompter — ORDEN DEFINITIVO según README oficial hako-mikan/sd-webui-regional-prompter
    // Fuente: [True,False,"Matrix","Vertical","Mask","Prompt","1,1,1","",False,False,False,"Attention",False,"0","0","0",""]
    //
    // [0]  active       bool   = true
    // [1]  debug        bool   = false
    // [2]  calcmode     str    = "Matrix" / "Mask" / "Prompt"
    // [3]  splitmode    str    = "Vertical" (Columns) / "Horizontal" (Rows) / "Random"
    //                            ⚠️ La UI muestra "Columns"/"Rows" pero la API espera "Vertical"/"Horizontal"
    // [4]  sub_mask     str    = "Mask"   (fijo, solo para modo Mask)
    // [5]  sub_prompt   str    = "Prompt" (fijo, solo para modo Prompt)
    // [6]  aratios      str    = "1,1"   (Divide Ratio)
    // [7]  bratios      str    = "0.2"   (Base Ratio)
    // [8]  flipflop     bool   = false   (Flip "," and ";")
    // [9]  usebase      bool   = false   (Use base prompt)
    // [10] usecom       bool   = false   (Use common prompt)
    // [11] dmode        str    = "Attention" / "Latent"  ← Generation Mode
    // [12] turbo        bool   = false
    // [13] lstop        str    = "0"
    // [14] lstop_hr     str    = "0"
    // [15] threshold    str    = "0"
    // [16] mask         str    = ""
    if (S.rp) {
      // Convertir "Columns"/"Rows" a los valores internos que espera la API
      const rpSplitAPI = S.rpSplitting === "Rows" ? "Horizontal"
                       : S.rpSplitting === "Columns" ? "Vertical"
                       : (S.rpSplitting || "Vertical");
      payload.alwayson_scripts["Regional Prompter"] = {
        args: [
          true,                           // [0]  active
          false,                          // [1]  debug
          S.rpCalcMode  || "Matrix",      // [2]  calcmode:   "Matrix" / "Mask" / "Prompt"
          rpSplitAPI,                     // [3]  splitmode:  "Vertical" / "Horizontal" / "Random"
          "Mask",                         // [4]  sub_mask    (fijo)
          "Prompt",                       // [5]  sub_prompt  (fijo)
          S.rpRatio     || "1,1",         // [6]  aratios:    Divide Ratio
          String(S.rpBase ?? "0.2"),      // [7]  bratios:    Base Ratio
          S.rpFlip      || false,         // [8]  flipflop:   Flip "," and ";"
          S.rpBasePrompt   || false,      // [9]  usebase:    Use base prompt
          S.rpCommonPrompt || false,      // [10] usecom:     Use common prompt
          S.rpMode      || "Attention",   // [11] dmode:      "Attention" / "Latent"
          false,                          // [12] turbo       (Use LoHa or other)
          "0",                            // [13] lstop
          "0",                            // [14] lstop_hr
          "0",                            // [15] threshold
          "",                             // [16] mask path
        ]
      };
    }

    // Upscale (hires.fix)
    if (S.upscale) {
      payload.enable_hr=true; payload.hr_scale=S.upscaleX;
      payload.hr_upscaler=S.upscaler; payload.denoising_strength=S.upscaleDn;
    }

    // Layer Diffusion — FIX BUG-03: ahora incluido en el payload
    if (S.layerDiff) {
      payload.alwayson_scripts["LayerDiffuse"] = {
        args: [{
          enabled: true,
          method: S.layerDiffMode || "Background Only",
          weight: S.layerDiffWeight !== undefined ? S.layerDiffWeight : 1.0,
          stop_at: 1.0,
          foreground: null,
          background: null,
          blended: null,
        }]
      };
    }

    // ControlNet
    // ── ControlNet payload (FIX v21) ──────────────────────────────────────────
    // ══ CONTROLNET — DEFINITIVE FIX ══════════════════════════════════
    // ROOT CAUSE: reForge's get_preprocessor(module_name) returns None when the module
    // name is not found in its internal registry (even "none" may be unregistered in some builds).
    // try_crop_image_with_a1111_mask() then crashes with:
    //   AttributeError: 'NoneType' object has no attribute 'corp_image_with_a1111_mask...'
    //
    // SOLUTION: NEVER send a `module` field. Omit it entirely. This forces reForge to skip
    // the preprocessor lookup completely. The image is sent as-is (raw or pre-processed).
    //
    // If the user wants preprocessing (openpose, canny, etc.) they MUST use the
    // "▶ Correr Preprocesador" button first — then we send the pre-processed image.
    //
    // All 3 unit stubs always present in args[] → prevents KeyError: 0.
    // ═════════════════════════════════════════════════════════════════
    const hasAnyCNReady = S.cnUnits.some(u => u.enabled && u.model && u.model !== "none" && (u.imageB64 || u.preprocessedB64));
    if (hasAnyCNReady) {
      payload.alwayson_scripts["ControlNet"] = {
        args: S.cnUnits.map(u => {
          const hasModel = u.enabled && u.model && u.model !== "none";
          const srcB64   = u.preprocessedB64 || u.imageB64 || null;
          const hasImage = !!srcB64;

          // Without BOTH model+image → disabled stub (prevents KeyError: 0)
          if (!hasModel || !hasImage) {
            // Stub must have NO module field — omitting prevents registry lookup
            return { enabled: false, image: null };
          }

          const imgData = srcB64.includes(",") ? srcB64.split(",")[1] : srcB64;
          const cmInt   = u.mode === "Prefer Prompt" ? 1 : u.mode === "Prefer ControlNet" ? 2 : 0;
          // threshold must be int ≥ 0; use safe defaults
          const thA     = (u.threshA != null && u.threshA >= 0) ? Math.round(u.threshA) : 64;
          const thB     = (u.threshB != null && u.threshB >= 0) ? Math.round(u.threshB) : 64;

          return {
            enabled:          true,
            image:            imgData,
            // NO `module` field — omitting it prevents get_preprocessor() crash in reForge.
            // The image is already pre-processed by "▶ Correr Preprocesador" if user ran it.
            // model: exact name from /controlnet/model_list
            model:            u.model,
            weight:           u.weight,
            guidance_start:   u.startStep,
            guidance_end:     u.endStep,
            // control_mode as integer — universally accepted by all reForge/A1111 versions
            control_mode:     cmInt,
            // resize_mode as integer — Forge built-in uses ints (0/1/2)
            resize_mode:      u.resize === "Just Resize" ? 0
                            : u.resize === "Resize and Fill" ? 2
                            : 1,
            pixel_perfect:    u.pixelPerfect,
            low_vram:         u.lowVram,
            processor_res:    u.detectRes || 512,
            image_resolution: u.detectRes || 512,
            threshold_a:      thA,
            threshold_b:      thB,
          };
        })
      };
    }

    try {
      const data = await POST("/sdapi/v1/txt2img", payload);
      clearInterval(S._pt);
      const imgs=(data.images||[]).map(i=>"data:image/png;base64,"+i);
      const job=S.history.find(j=>j.id===jobId);
      if(job){job.images=imgs;job.status="done";job.progress=100;}
      S.liveImg=null;
    } catch(e) {
      clearInterval(S._pt);
      const job=S.history.find(j=>j.id===jobId);
      if(job){job.status="error";job.error=e.message;}
      S.liveImg=null; notify("❌ "+e.message,true);
    }
    S.busy=false; S.progress=0;
    updateGenBtn(); updateTaskCard(jobId);
    scheduleSave();
  }

  /* ══ GENERATE — img2img ══════════════════════
     FIX BUG-01: Img2Img completamente implementado
  ═════════════════════════════════════════════ */
  async function generateI2I() {
    if (S.busy) return;
    if (!S.i2iImageB64) { notify("⚠️ Sube una imagen primero", true); return; }
    if (!S.i2iPrompt.trim()) { notify("⚠️ Escribe un prompt para la modificación", true); return; }
    const ar = AR[S.ar];
    const w = snap8(ar.w || S.cw);
    const h = snap8(ar.h || S.ch);
    const imgB64 = S.i2iImageB64.includes(",") ? S.i2iImageB64.split(",")[1] : S.i2iImageB64;
    const count = parseInt(S.count) || 1;
    const jobId = uid();
    const params = {
      prompt: S.i2iPrompt, neg: S.i2iNeg||S.neg, w, h,
      sampler: S.sampler, scheduler: S.scheduler,
      steps: S.steps, cfg: S.cfg, seed: S.seed||"−1", count,
      model: S.model, loras: "—",
      mode: "img2img", dn: S.i2iDn, ts: nowTs(),
      adetailer: S.adetailer,
      adSlots: S.adetailer ? S.adSlots.filter(s=>s.enabled).map(s=>s.model) : [],
    };
    S.busy = true; S.progress = 0; S.eta = 0; S.liveImg = null;
    S.history.unshift({id:jobId,params,images:[],status:"generating",progress:0});
    updateGenBtn(); mui.tab("tasks");

    S._pt = setInterval(async()=>{
      const p = await GET("/sdapi/v1/progress?skip_current_image=false");
      if (!p) return;
      const pct = Math.round((p.progress||0)*100);
      S.progress = pct; S.eta = Math.round(p.eta_relative||0);
      if (p.current_image) S.liveImg = "data:image/png;base64,"+p.current_image;
      const job = S.history.find(j=>j.id===jobId);
      if (job) { job.progress = pct; job.eta = S.eta; }
      updateTaskCard(jobId); updateGenBtn();
    }, 900);

    const resizeModeMap = { "Just Resize":0, "Crop and Resize":1, "Fill":2, "Latent Upscale":3 };
    const payload = {
      init_images: [imgB64],
      prompt: S.i2iPrompt,
      negative_prompt: S.i2iNeg || S.neg,
      width: w, height: h,
      sampler_name: S.sampler,
      scheduler: S.scheduler !== "Automatic" ? S.scheduler : undefined,
      steps: S.steps, cfg_scale: S.cfg,
      seed: S.seed ? parseInt(S.seed) : -1,
      n_iter: 1, batch_size: count,
      denoising_strength: S.i2iDn,
      resize_mode: resizeModeMap[S.i2iResizeMode] ?? 0,
      alwayson_scripts: {},
    };

    // ADetailer — usa los mismos adSlots que txt2img
    if (S.adetailer) {
      const enabledSlots = S.adSlots.filter(s => s.enabled);
      if (enabledSlots.length) {
        payload.alwayson_scripts["ADetailer"] = {
          args: [
            true,
            ...enabledSlots.map(s => ({
              ad_model: s.model,
              ad_confidence: s.conf,
              ad_denoising_strength: s.dn,
              ad_prompt: s.prompt || "",
              ad_negative_prompt: s.neg || "",
              ad_inpaint_width: 512,
              ad_inpaint_height: 512,
              ad_use_inpaint_width_height: false,
            }))
          ]
        };
      }
    }

    // ControlNet — misma lógica que txt2img (FIX v21)
    const hasAnyCNReadyI2I = S.cnUnits.some(u => u.enabled && u.model && u.model !== "none" && (u.imageB64 || u.preprocessedB64));
    if (hasAnyCNReadyI2I) {
      payload.alwayson_scripts["ControlNet"] = {
        args: S.cnUnits.map(u => {
          const hasModel = u.enabled && u.model && u.model !== "none";
          const srcB64   = u.preprocessedB64 || u.imageB64 || null;
          const hasImage = !!srcB64;
          if (!hasModel || !hasImage) return { enabled: false, image: null };
          const imgData = srcB64.includes(",") ? srcB64.split(",")[1] : srcB64;
          const cmInt   = u.mode === "Prefer Prompt" ? 1 : u.mode === "Prefer ControlNet" ? 2 : 0;
          const thA     = (u.threshA != null && u.threshA >= 0) ? Math.round(u.threshA) : 64;
          const thB     = (u.threshB != null && u.threshB >= 0) ? Math.round(u.threshB) : 64;
          return {
            enabled: true, image: imgData, model: u.model,
            weight: u.weight, guidance_start: u.startStep, guidance_end: u.endStep,
            control_mode: cmInt,
            resize_mode: u.resize === "Just Resize" ? 0 : u.resize === "Resize and Fill" ? 2 : 1,
            pixel_perfect: u.pixelPerfect, low_vram: u.lowVram,
            processor_res: u.detectRes || 512, image_resolution: u.detectRes || 512,
            threshold_a: thA, threshold_b: thB,
          };
        })
      };
    }

    try {
      const data = await POST("/sdapi/v1/img2img", payload);
      clearInterval(S._pt);
      const imgs = (data.images||[]).map(i=>"data:image/png;base64,"+i);
      const job = S.history.find(j=>j.id===jobId);
      if (job) { job.images = imgs; job.status = "done"; job.progress = 100; }
      S.liveImg = null;
    } catch(e) {
      clearInterval(S._pt);
      const job = S.history.find(j=>j.id===jobId);
      if (job) { job.status = "error"; job.error = e.message; }
      S.liveImg = null; notify("❌ "+e.message, true);
    }
    S.busy = false; S.progress = 0;
    updateGenBtn(); updateTaskCard(jobId);
    scheduleSave();
  }

  /* ══ STOP GENERATION ════════════════════════
     MEJORA-10: cancela la generación en curso
  ═════════════════════════════════════════════ */
  async function stopGeneration() {
    try {
      await POST("/sdapi/v1/interrupt", {});
      clearInterval(S._pt);
      S.busy = false; S.progress = 0;
      updateGenBtn();
      notify(T.stopped);
      const gen = S.history.find(j=>j.status==="generating");
      if (gen) { gen.status = "error"; gen.error = "Detenido por el usuario"; updateTaskCard(gen.id); }
    } catch(e) {
      notify(T.stopError, true);
    }
  }

  /* ══ CSS ═════════════════════════════════════ */
  const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');

#muiFab{position:fixed !important;bottom:74px !important;left:10px !important;z-index:2147483600 !important;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;border:none;border-radius:50px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px;box-shadow:0 3px 14px rgba(124,58,237,.6);touch-action:manipulation;font-family:'Sora',sans-serif !important;}
#muiFab.hidden{display:none !important;}
#muiRoot{all:initial;position:fixed !important;top:0 !important;left:0 !important;z-index:2147483500 !important;}
#muiOv{position:fixed !important;top:0 !important;left:0 !important;width:100vw;height:100vh;z-index:2147483500 !important;background:#0e0e16 !important;overflow:hidden !important;display:none;flex-direction:column;font-family:'Sora',sans-serif !important;font-size:14px !important;color:#e5e7eb !important;line-height:1.45 !important;-webkit-font-smoothing:antialiased !important;margin:0 !important;padding:0 !important;border:none !important;transform:none !important;}
#muiOv.open{display:flex !important;}
#muiOv *,#muiOv *::before,#muiOv *::after{box-sizing:border-box !important;-webkit-tap-highlight-color:transparent !important;font-family:'Sora',sans-serif !important;}

.H{display:flex;align-items:center;justify-content:space-between;padding:11px 13px 0;flex-shrink:0;background:#0e0e16;gap:8px;}
.H-l{display:flex;align-items:center;gap:8px;}
.HX{background:#1e1e2e;border:none;color:#9ca3af;width:30px;height:30px;border-radius:50%;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;touch-action:manipulation;flex-shrink:0;}
.HT{font-size:15px;font-weight:700;color:#fff;}
.HBG{background:#1e1e2e;border:1px solid #2d2d45;border-radius:20px;padding:3px 10px;font-size:11px;color:#f59e0b;font-weight:700;display:flex;align-items:center;gap:3px;white-space:nowrap;}
.HRB{background:#1e1e2e;border:1px solid #2d2d45;color:#9ca3af;border-radius:7px;padding:5px 9px;font-size:12px;cursor:pointer;touch-action:manipulation;}
.TABS{display:flex;padding:8px 12px 0;overflow-x:auto;scrollbar-width:none;flex-shrink:0;border-bottom:1px solid #1e1e2e;background:#0e0e16;}
.TABS::-webkit-scrollbar{display:none;}
.TAB{background:transparent;border:none;color:#6b7280;font-size:13px;font-weight:500;padding:6px 13px 8px;cursor:pointer;white-space:nowrap;position:relative;transition:color .15s;touch-action:manipulation;flex-shrink:0;}
.TAB.on{color:#06b6d4;}
.TAB.on::after{content:'';position:absolute;bottom:0;left:6px;right:6px;height:2px;background:#06b6d4;border-radius:2px;}
.TAB .dot{display:inline-block;width:6px;height:6px;background:#ef4444;border-radius:50%;margin-left:4px;vertical-align:middle;}
.BODY{flex:1;overflow-y:auto;overflow-x:hidden;padding:9px 11px 6px;scrollbar-width:thin;scrollbar-color:#2d2d45 transparent;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:#0e0e16;}
.BODY::-webkit-scrollbar{width:3px;}
.BODY::-webkit-scrollbar-thumb{background:#2d2d45;border-radius:4px;}

.C{background:#13132a;border:1px solid #1e1e34;border-radius:13px;padding:13px;margin-bottom:9px;}
.CT{font-size:13px;font-weight:700;color:#fff;margin:0 0 9px;}
.CL{font-size:11px;color:#6b7280;font-weight:500;margin-bottom:4px;}
.SC{background:#0a0a18;border:1px solid #232338;border-radius:9px;padding:11px;margin-top:8px;animation:sin .2s ease;}
@keyframes sin{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.SCL{font-size:10px;font-weight:700;color:#7c3aed;letter-spacing:.07em;text-transform:uppercase;margin-bottom:7px;}

.PTA{width:100%;background:transparent;border:none;color:#e5e7eb;font-size:14px;line-height:1.6;resize:none;outline:none;min-height:80px;}
.PTA::placeholder{color:#303050;}
.NTA{width:100%;background:transparent;border:none;color:#c9cdd4;font-size:12px;line-height:1.5;resize:none;outline:none;min-height:36px;}
.NTA::placeholder{color:#303050;}
.NL{font-size:10px;font-weight:700;color:#ef4444;letter-spacing:.06em;margin-bottom:4px;display:flex;align-items:center;gap:4px;}
.HR{border:none;border-top:1px solid #1e1e34;margin:8px 0;}
.TBAR{display:flex;gap:5px;}
.TBTN{background:#1e1e2e;border:1px solid #2d2d45;color:#9ca3af;border-radius:7px;padding:6px 10px;font-size:14px;cursor:pointer;touch-action:manipulation;}
.TBTN:active{background:#252545;}

.MB{display:inline-block;background:#1e1e2e;border:1px solid #2d2d45;border-radius:5px;padding:2px 7px;font-size:10px;font-weight:700;color:#06b6d4;margin-bottom:6px;}
.MB.lor{color:#a855f7;}

.MR{display:flex;align-items:center;gap:11px;padding:9px 11px;background:#1a1a2e;border:1px solid #1e1e34;border-radius:11px;cursor:pointer;transition:border-color .15s;margin-bottom:7px;touch-action:manipulation;}
.MR.sel{border-color:#7c3aed66;}
.MR:active{background:#1e1e38;}
.MR.loading{border-color:#f59e0b66;animation:mpulse 1s ease-in-out infinite;}
@keyframes mpulse{0%,100%{opacity:1}50%{opacity:.6}}
.MTH{width:48px;height:48px;border-radius:8px;background:linear-gradient(135deg,#7c3aed33,#06b6d433);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;overflow:hidden;}
.MINFO{flex:1;overflow:hidden;}
.MNM{font-size:13px;font-weight:600;color:#e5e7eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.TWP{display:inline-block;margin-top:2px;background:#7c3aed22;border:1px solid #7c3aed44;border-radius:20px;padding:1px 6px;font-size:10px;color:#a78bfa;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}
.MARR{color:#4b5563;font-size:14px;flex-shrink:0;}

.LR{display:flex;align-items:center;gap:9px;background:#1a1a2e;border:1px solid #1e1e34;border-radius:10px;padding:9px 11px;margin-bottom:7px;}
.LR-thumb{width:40px;height:40px;border-radius:7px;background:linear-gradient(135deg,#7c3aed33,#06b6d433);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;overflow:hidden;cursor:pointer;}
.LR-name{flex:1;font-size:12px;font-weight:600;color:#e5e7eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}
.LR-w{width:38px;background:#13132a;border:1px solid #1e1e34;border-radius:6px;padding:5px 4px;color:#e5e7eb;font-size:12px;text-align:center;outline:none;flex-shrink:0;}
.LR-del{background:#ef444422;border:1px solid #ef444433;color:#f87171;border-radius:6px;width:26px;height:26px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;touch-action:manipulation;flex-shrink:0;}

.LW{background:#0c0c1c;border:1px solid #1e1e34;border-radius:9px;padding:9px 11px;margin-bottom:7px;display:flex;align-items:center;gap:8px;}
.LWL{font-size:11px;color:#6b7280;font-weight:600;white-space:nowrap;}
.RNG{-webkit-appearance:none;appearance:none;height:4px;border-radius:4px;outline:none;cursor:pointer;background:linear-gradient(to right,#7c3aed var(--p,50%),#2d2d45 var(--p,50%));}
.RNG::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px #7c3aed;}
.RV{font-size:12px;color:#e5e7eb;font-weight:600;min-width:30px;text-align:center;}
.RM,.RP{background:#1e1e2e;border:1px solid #2d2d45;color:#9ca3af;border-radius:6px;width:24px;height:24px;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;touch-action:manipulation;flex-shrink:0;}

.AB{background:#13132a;border:1px dashed #2d2d45;color:#6b7280;border-radius:10px;padding:10px;width:100%;font-size:12px;cursor:pointer;margin-bottom:6px;touch-action:manipulation;}
.AB:active{border-color:#7c3aed55;}
.ABR{display:flex;gap:7px;}
.ABR .AB{flex:1;}

.AR{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;}
.ARB{background:#1a1a2e;border:1px solid #1e1e34;border-radius:9px;padding:8px 3px;cursor:pointer;text-align:center;transition:all .2s;touch-action:manipulation;}
.ARB.on{background:#06b6d418;border-color:#06b6d4;}
.ARB.on .AI,.ARB.on .AL{color:#06b6d4;}
.AI{font-size:17px;display:block;margin-bottom:2px;color:#6b7280;}
.AL{font-size:10px;font-weight:700;color:#9ca3af;}
.AS{font-size:9px;color:#4b5563;margin-top:1px;}

.R2{display:flex;gap:8px;margin-bottom:8px;}
.FG{flex:1;}
.INP{width:100%;background:#1a1a2e;border:1px solid #1e1e34;border-radius:7px;padding:8px 11px;color:#e5e7eb;font-size:13px;outline:none;transition:border-color .15s;}
.INP:focus{border-color:#7c3aed66;}
.SEL{width:100%;background:#1a1a2e;border:1px solid #1e1e34;border-radius:7px;padding:8px 26px 8px 11px;color:#e5e7eb;font-size:13px;outline:none;cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;}
.SLR{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.SLI{width:46px;background:#1a1a2e;border:1px solid #1e1e34;border-radius:7px;padding:6px 5px;color:#e5e7eb;font-size:12px;text-align:center;outline:none;flex-shrink:0;}

.TR{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1a1a2e;}
.TR:last-of-type{border-bottom:none;}
.TL{font-size:13px;color:#e5e7eb;font-weight:500;}
.TOG{position:relative;display:inline-block;width:40px;height:21px;}
.TOG input{display:none;}
.TOGS{position:absolute;inset:0;background:#1e1e2e;border-radius:21px;cursor:pointer;transition:background .2s;}
.TOGS::before{content:'';position:absolute;width:15px;height:15px;left:3px;top:3px;background:#6b7280;border-radius:50%;transition:transform .2s,background .2s;}
.TOG input:checked + .TOGS{background:#7c3aed44;}
.TOG input:checked + .TOGS::before{transform:translateX(19px);background:#7c3aed;}

.AD-TABS{display:flex;gap:3px;margin-bottom:10px;overflow-x:auto;scrollbar-width:none;}
.AD-TABS::-webkit-scrollbar{display:none;}
.AD-TAB{background:#1a1a2e;border:1px solid #1e1e34;border-radius:7px;padding:5px 11px;font-size:11px;font-weight:600;color:#6b7280;cursor:pointer;white-space:nowrap;touch-action:manipulation;transition:all .15s;flex-shrink:0;}
.AD-TAB.on{background:#7c3aed22;border-color:#7c3aed66;color:#a78bfa;}
.AD-TAB .on-dot{display:inline-block;width:5px;height:5px;background:#22d3ee;border-radius:50%;margin-left:4px;vertical-align:middle;}

.RP-BTNS{display:flex;gap:6px;margin-bottom:8px;}
.RP-BTN{flex:1;background:#1a1a2e;border:1px solid #1e1e34;border-radius:8px;padding:7px;font-size:12px;color:#6b7280;cursor:pointer;text-align:center;touch-action:manipulation;transition:all .15s;}
.RP-BTN.on{background:#7c3aed22;border-color:#7c3aed66;color:#a78bfa;font-weight:600;}
.RP-CK{display:flex;align-items:center;gap:7px;margin-bottom:7px;}
.RP-CK input[type=checkbox]{width:15px;height:15px;accent-color:#7c3aed;flex-shrink:0;}
.RP-CK label{font-size:12px;color:#9ca3af;cursor:pointer;}

.CN-TABS{display:flex;gap:3px;margin-bottom:10px;overflow-x:auto;scrollbar-width:none;}
.CN-TABS::-webkit-scrollbar{display:none;}
.CN-TAB{background:#1a1a2e;border:1px solid #1e1e34;border-radius:7px;padding:5px 13px;font-size:11px;font-weight:600;color:#6b7280;cursor:pointer;white-space:nowrap;touch-action:manipulation;transition:all .15s;flex-shrink:0;}
.CN-TAB.on{background:#06b6d418;border-color:#06b6d466;color:#22d3ee;}
.CN-TAB .en-dot{display:inline-block;width:5px;height:5px;background:#22d3ee;border-radius:50%;margin-left:4px;vertical-align:middle;}
.CN-DROP{width:100%;height:120px;border:2px dashed #2d2d45;border-radius:10px;background:#0a0a18;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;margin-bottom:9px;position:relative;overflow:hidden;touch-action:manipulation;-webkit-user-select:none;user-select:none;}
.CN-DROP:active{border-color:#06b6d466;background:#0d0d20;}
.CN-RUN-BTN{width:100%;background:linear-gradient(135deg,#7c3aed55,#06b6d455);border:1px solid #7c3aed77;border-radius:9px;padding:10px;font-size:13px;font-weight:600;color:#e5e7eb;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;margin-bottom:9px;touch-action:manipulation;transition:all .15s;}
.CN-RUN-BTN:active{opacity:.8;}
.CN-RUN-BTN:disabled{opacity:.5;cursor:not-allowed;}
.CN-PREV{width:100%;border-radius:10px;overflow:hidden;margin-bottom:9px;position:relative;}
.CN-PREV img{width:100%;display:block;border-radius:10px;}
.CN-PREV-LBL{font-size:10px;color:#06b6d4;font-weight:600;letter-spacing:.05em;text-transform:uppercase;margin-bottom:4px;}
.CN-PREV-OVR{position:absolute;top:5px;right:5px;}
.CN-PREV-CLR{background:rgba(239,68,68,.85);border:none;border-radius:6px;color:#fff;padding:4px 10px;font-size:11px;cursor:pointer;touch-action:manipulation;}
.CN-THRESH{background:#0c0c1c;border:1px solid #1e1e34;border-radius:8px;padding:9px 11px;margin-bottom:9px;}
.CN-DROP.has-img{border-style:solid;border-color:#06b6d466;}
.CN-DROP img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:9px;}
.CN-DROP-OVR{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(14,14,22,.7);border-radius:9px;}
.CN-DROP-LBL{color:#6b7280;font-size:12px;text-align:center;padding:10px;}
.CN-PPB{background:#1a1a2e;border:1px solid #1e1e34;border-radius:6px;padding:4px 9px;font-size:11px;color:#6b7280;cursor:pointer;touch-action:manipulation;transition:all .15s;white-space:nowrap;}
.CN-PPB.on{background:#06b6d418;border-color:#06b6d455;color:#22d3ee;font-weight:600;}
.CN-MODEBTS{display:flex;gap:5px;margin-bottom:8px;}
.CN-MODEBTS .CN-PPB{flex:1;text-align:center;}
.CN-RZBTS{display:flex;gap:5px;margin-bottom:8px;}
.CN-RZBTS .CN-PPB{flex:1;text-align:center;font-size:10px;}
.CN-FILEINP{display:none;}

/* I2I upload zone */
.I2I-DROP{width:100%;min-height:160px;border:2px dashed #2d2d45;border-radius:13px;background:#0a0a18;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;margin-bottom:9px;position:relative;overflow:hidden;touch-action:manipulation;}
.I2I-DROP.has-img{border-style:solid;border-color:#7c3aed66;}
.I2I-DROP img{width:100%;height:100%;object-fit:contain;display:block;}
.I2I-DROP-OVR{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(14,14,22,.75);}

.BAR{padding:9px 11px;background:#0e0e16;border-top:1px solid #1e1e2e;display:flex;gap:8px;align-items:center;flex-shrink:0;}
.CSEL{background:#1a1a2e;border:1px solid #1e1e34;border-radius:10px;padding:10px 11px;color:#e5e7eb;font-size:13px;outline:none;cursor:pointer;min-width:90px;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;padding-right:24px;touch-action:manipulation;}
.GBN{flex:1;background:linear-gradient(135deg,#7c3aed,#06b6d4);border:none;border-radius:12px;color:#fff;font-size:15px;font-weight:700;padding:12px;cursor:pointer;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;gap:7px;transition:opacity .2s;touch-action:manipulation;}
.GBN:disabled{opacity:.65;cursor:not-allowed;}
.GBN:active:not(:disabled){opacity:.82;}
.GBN.stop-btn{background:linear-gradient(135deg,#ef4444,#f97316);}
.GPB{position:absolute;left:0;top:0;height:100%;background:rgba(255,255,255,.15);transition:width .4s;border-radius:12px;pointer-events:none;}
.GTX{position:relative;z-index:1;display:flex;align-items:center;gap:6px;}

.TEMPTY{text-align:center;padding:52px 20px;color:#4b5563;}
.TEMPTY .EI{font-size:46px;margin-bottom:11px;}
.TC{border-radius:13px;margin-bottom:9px;overflow:hidden;}
.TC-G{background:#13132a;border:1px solid #7c3aed66;}
.TC-D{background:#13132a;border:1px solid #1e1e34;}
.TC-E{background:#13132a;border:1px solid #ef444455;}
.TC-TOP{padding:11px 12px 9px;}
.TC-SR{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.TC-BG{border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;}
.BG-G{background:#7c3aed22;color:#a78bfa;border:1px solid #7c3aed55;}
.BG-D{background:#06b6d422;color:#22d3ee;border:1px solid #06b6d455;}
.BG-E{background:#ef444422;color:#f87171;border:1px solid #ef444455;}
.TC-TS{font-size:10px;color:#6b7280;}
.TC-MDL{font-size:11px;color:#9ca3af;margin-bottom:6px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
.TC-MDL span{color:#e5e7eb;font-weight:600;}
.TC-P{background:#0a0a18;border:1px solid #1e1e34;border-radius:7px;padding:6px 9px;font-size:12px;color:#9ca3af;line-height:1.5;margin-bottom:7px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.CHIPS{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:7px;}
.CHIP{background:#1a1a2e;border:1px solid #1e1e34;border-radius:20px;padding:2px 8px;font-size:10px;color:#9ca3af;white-space:nowrap;}
.CHIP.HL{color:#06b6d4;border-color:#06b6d455;}
.GP{margin-bottom:9px;}
.GPR{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}
.GPCT{font-size:12px;font-weight:700;color:#a78bfa;}
.GETA{font-size:11px;color:#6b7280;}
.GPBG{height:4px;background:#1e1e2e;border-radius:4px;overflow:hidden;}
.GPFG{height:100%;background:linear-gradient(90deg,#7c3aed,#06b6d4);border-radius:4px;transition:width .5s;}
.LP{width:100%;border-radius:9px;overflow:hidden;margin-bottom:9px;background:#0a0a18;min-height:72px;display:flex;align-items:center;justify-content:center;}
.LP img{width:100%;display:block;border-radius:9px;}
.LP-PH{color:#4b5563;font-size:12px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:18px;}
.IG{display:grid;gap:6px;padding:0 12px 10px;}
.IG.G1{grid-template-columns:1fr;}
.IG.G2,.IG.G4{grid-template-columns:1fr 1fr;}
.IW{position:relative;border-radius:9px;overflow:hidden;background:#0a0a18;cursor:pointer;}
.IW img{width:100%;display:block;}
.IACT{position:absolute;top:5px;right:5px;display:flex;gap:3px;}
.IA{background:rgba(0,0,0,.7);backdrop-filter:blur(4px);border:none;border-radius:6px;padding:5px 7px;font-size:13px;cursor:pointer;color:#fff;touch-action:manipulation;}
.TC-EX{padding:0 12px 11px;}
.EBTN{width:100%;background:#1a1a2e;border:1px solid #1e1e34;border-radius:7px;padding:8px;font-size:12px;color:#9ca3af;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;touch-action:manipulation;}
.PRMS{background:#0a0a18;border:1px solid #1e1e34;border-radius:8px;padding:9px;margin-top:6px;display:none;}
.PRMS.open{display:block;}
.PR{display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;border-bottom:1px solid #13132a;}
.PR:last-child{border-bottom:none;}
.PK{font-size:10px;color:#6b7280;font-weight:500;flex-shrink:0;}
.PV{font-size:11px;color:#e5e7eb;font-weight:500;text-align:right;max-width:65%;word-break:break-all;}

/* Lightbox MEJORA-11 */
#muiLB{display:none;position:fixed;inset:0;z-index:2147483900;background:rgba(0,0,0,.93);align-items:center;justify-content:center;flex-direction:column;}
#muiLB.open{display:flex;}
#muiLB img{max-width:96vw;max-height:86vh;border-radius:10px;object-fit:contain;}
.LB-BAR{display:flex;gap:10px;margin-top:12px;align-items:center;}
.LB-BTN{background:#1e1e2e;border:1px solid #2d2d45;color:#e5e7eb;border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer;touch-action:manipulation;}
.LB-BTN.dl{background:linear-gradient(135deg,#7c3aed,#06b6d4);border:none;font-weight:700;}
.LB-NAV{display:flex;gap:8px;}
.LB-N{background:#1e1e2e;border:1px solid #2d2d45;color:#9ca3af;border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;touch-action:manipulation;}
.LB-N:disabled{opacity:.3;cursor:default;}

.MDL{display:none;position:fixed;inset:0;z-index:2147483700;background:rgba(0,0,0,.82);align-items:flex-end;}
.MDL.open{display:flex;}
.SHT{background:#13132a;border:1px solid #1e1e34;border-radius:18px 18px 0 0;padding:15px 13px;width:100%;max-height:75vh;overflow-y:auto;overscroll-behavior:contain;}
.SH-T{font-size:14px;font-weight:700;color:#fff;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;}
.SH-X{background:none;border:none;color:#6b7280;font-size:18px;cursor:pointer;}
.SHCNT{font-size:11px;color:#6b7280;font-weight:400;margin-left:4px;}
.MSRCH{width:100%;background:#1a1a2e;border:1px solid #1e1e34;border-radius:7px;padding:9px 11px;color:#e5e7eb;font-size:14px;outline:none;margin-bottom:8px;}
.MI{display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:10px;cursor:pointer;transition:background .12s;margin-bottom:3px;touch-action:manipulation;min-height:58px;}
.MI:active{background:#1e1e2e;}
.MI.on{background:#7c3aed1a;}
.MITH{width:48px;height:48px;border-radius:8px;background:linear-gradient(135deg,#7c3aed33,#06b6d433);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;overflow:hidden;}
.MI-I{flex:1;overflow:hidden;}
.MIT{font-size:13px;color:#e5e7eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;}
.MIC{color:#7c3aed;font-size:14px;flex-shrink:0;}

#muiToast{position:fixed;top:15px;left:50%;transform:translateX(-50%) translateY(-58px);z-index:2147483800;background:#1e1e2e;border:1px solid #2d2d45;border-radius:9px;padding:8px 14px;color:#e5e7eb;font-size:13px;transition:transform .28s;white-space:nowrap;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.5);font-family:'Sora',sans-serif;}
#muiToast.show{transform:translateX(-50%) translateY(0);}
#muiToast.err{border-color:#ef4444;color:#fca5a5;}

@keyframes muiSpin{to{transform:rotate(360deg)}}
.SPIN{width:15px;height:15px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:muiSpin .6s linear infinite;}
`;

  /* ══ HTML ════════════════════════════════════ */
  const HTML = `
<div id="muiToast"></div>
<button id="muiFab" onclick="mui.open()">📱 Mobile UI</button>
<div id="muiOv">
  <div class="H">
    <div class="H-l">
      <button class="HX" onclick="mui.close()">✕</button>
      <span class="HT">SD Studio</span>
    </div>
    <div style="display:flex;gap:5px;align-items:center">
      <button class="HRB" onclick="mui.refresh()">🔄</button>
      <div class="HBG">⚡ ReForge</div>
    </div>
  </div>
  <div class="TABS">
    <button class="TAB on" id="t-txt2img" onclick="mui.tab('txt2img')">Text2Img</button>
    <button class="TAB"    id="t-img2img" onclick="mui.tab('img2img')">Img2Img</button>
    <button class="TAB"    id="t-tasks"   onclick="mui.tab('tasks')">Tasks</button>
    <button class="TAB"    id="t-extra"   onclick="mui.tab('extra')">Extra</button>
  </div>
  <div class="BODY" id="muiBody"></div>
  <div class="BAR">
    <select class="CSEL" id="muiCsel" onchange="S.count=parseInt(this.value)||1">
      <option value="1">1 img</option>
      <option value="2">2 imgs</option>
      <option value="4">4 imgs</option>
    </select>
    <button class="GBN" id="muiGB" onclick="mui.genOrStop()">
      <div class="GPB" id="muiPB" style="width:0%"></div>
      <span class="GTX" id="muiGT">⚡ Generar</span>
    </button>
  </div>
</div>
<!-- Lightbox MEJORA-11 -->
<div id="muiLB" onclick="if(event.target===this)mui.lbClose()">
  <img id="muiLBImg" src="" alt="preview">
  <div class="LB-BAR">
    <div class="LB-NAV">
      <button class="LB-N" id="muiLBPrev" onclick="mui.lbNav(-1)">‹</button>
      <button class="LB-N" id="muiLBNext" onclick="mui.lbNav(1)">›</button>
    </div>
    <button class="LB-BTN dl" onclick="mui.lbDl()">💾 Guardar</button>
    <button class="LB-BTN" onclick="mui.lbClose()">✕ Cerrar</button>
  </div>
</div>
<!-- Model modal -->
<div id="mdlM" class="MDL" onclick="if(event.target===this)mui.cm('mdlM')">
  <div class="SHT">
    <div class="SH-T">Checkpoint <span id="mdlC" class="SHCNT"></span>
      <button class="SH-X" onclick="mui.cm('mdlM')">✕</button></div>
    <input class="MSRCH" placeholder="🔍 Buscar…" id="mdlS" oninput="mui.fm(this.value)">
    <div id="mdlL"></div>
  </div>
</div>
<!-- LoRA modal -->
<div id="lorM" class="MDL" onclick="if(event.target===this)mui.cm('lorM')" data-slot="0">
  <div class="SHT">
    <div class="SH-T">LoRA <span id="lorC" class="SHCNT"></span>
      <button class="SH-X" onclick="mui.cm('lorM')">✕</button></div>
    <input class="MSRCH" placeholder="🔍 Buscar…" id="lorS" oninput="mui.fl(this.value)">
    <div id="lorL"></div>
  </div>
</div>
<!-- ControlNet CN model modal -->
<div id="cnMdlM" class="MDL" onclick="if(event.target===this)mui.cm('cnMdlM')">
  <div class="SHT">
    <div class="SH-T">CN Model <span id="cnMdlC" class="SHCNT"></span>
      <button class="SH-X" onclick="mui.cm('cnMdlM')">✕</button></div>
    <input class="MSRCH" placeholder="🔍 Buscar modelo CN…" id="cnMdlS" oninput="mui.cnfm(this.value)">
    <div id="cnMdlL"></div>
  </div>
</div>
<!-- Hidden file inputs for CN + I2I -->
<input type="file" id="cnFileInp0" class="CN-FILEINP" accept="image/*" data-unit="0" onchange="mui.cnImgLoad(this)">
<input type="file" id="cnFileInp1" class="CN-FILEINP" accept="image/*" data-unit="1" onchange="mui.cnImgLoad(this)">
<input type="file" id="cnFileInp2" class="CN-FILEINP" accept="image/*" data-unit="2" onchange="mui.cnImgLoad(this)">
<input type="file" id="i2iFileInp" class="CN-FILEINP" accept="image/*" onchange="mui.i2iImgLoad(this)">`;

  /* ══ RENDER ══════════════════════════════════ */
  function rerender() {
    const el=$("muiBody"); if(!el) return;
    if      (S.tab==="txt2img") el.innerHTML=rTxt();
    else if (S.tab==="img2img") el.innerHTML=rI2I();
    else if (S.tab==="tasks")   el.innerHTML=rTasks();
    else                        el.innerHTML=rExtra();
  }

  /* ── SECCIÓN: Prompt ─────────────────────────────── */
  function rPromptSection() {
    return `
<div class="C">
  <textarea class="PTA" id="mTa"
    placeholder="Describe tu imagen… ej: 1girl, anime style, sunset"
    oninput="S.prompt=this.value;scheduleSave()">${esc(S.prompt)}</textarea>
  <hr class="HR">
  <div class="NL">🚫 NEGATIVO</div>
  <textarea class="NTA" id="mNg" placeholder="worst quality, low quality…"
    oninput="S.neg=this.value;scheduleSave()">${esc(S.neg)}</textarea>
  <hr class="HR">
  <div class="TBAR">
    <button class="TBTN" onclick="mui.rp()" title="Prompt aleatorio">🎲</button>
    <button class="TBTN" onclick="mui.cp()" title="Limpiar prompt">🗑️</button>
    <button class="TBTN" onclick="mui.cpy()" title="Copiar prompt">📋</button>
  </div>
</div>`;
  }

  /* ── SECCIÓN: Modelos ───────────────────────────── */
  function rModelsSection() {
    const cm=S.models.find(m=>m.t===S.model)||null;
    const ml=cm?cm.t.replace(/\.[^/.]+$/,"").slice(0,32):(S.models.length?"Toca para elegir":"Cargando…");
    const mdlThumb=cm&&cm.preview.length?imgTag(cm.preview,"🎨"):'<span style="font-size:20px">🎨</span>';
    // MEJORA-08: clase loading si el modelo está cambiando
    const loadingCls = S._modelChanging ? " loading" : "";
    return `
<div class="C">
  <div class="CT">Modelos</div>
  <div class="MB">Checkpoint</div>
  <div class="MR ${cm?"sel":""}${loadingCls}" onclick="mui.om()">
    <div class="MTH" data-fb="🎨">${mdlThumb}</div>
    <div class="MINFO">
      <div class="MNM">${esc(ml)}</div>
      ${S._modelChanging?'<div style="font-size:10px;color:#f59e0b">⏳ Cargando…</div>':""}
    </div>
    <span class="MARR">›</span>
  </div>
  <div class="MB lor">LoRA</div>
  <div id="loraList">${rLoraList()}</div>
  <button class="AB" onclick="mui.addLora()" style="margin-top:2px">+ Agregar LoRA</button>
  <div class="ABR" style="margin-top:4px">
    <button class="AB" onclick="mui.addEmbedding()">+ Embedding / TI</button>
  </div>
</div>`;
  }

  /* ── SECCIÓN: Aspect Ratio ──────────────────────── */
  function rARSection() {
    return `
<div class="C">
  <div class="CT">Aspect Ratio</div>
  <div class="AR">
    ${Object.entries(AR).map(([k,v])=>`
    <button class="ARB ${S.ar===k?"on":""}" onclick="mui.ar('${k}')">
      <span class="AI">${v.icon}</span><div class="AL">${v.lbl}</div><div class="AS">${v.sub}</div>
    </button>`).join("")}
  </div>
  ${S.ar==="custom"?`
  <div class="R2">
    <div class="FG"><div class="CL">Width (múlt. de 8)</div><input class="INP" type="number" value="${S.cw}" min="64" max="2048" step="8" oninput="S.cw=snap8(this.value);scheduleSave()"></div>
    <div class="FG"><div class="CL">Height (múlt. de 8)</div><input class="INP" type="number" value="${S.ch}" min="64" max="2048" step="8" oninput="S.ch=snap8(this.value);scheduleSave()"></div>
  </div>`:""}
</div>`;
  }

  /* ── SECCIÓN: Sampler ───────────────────────────── */
  function rSamplerSection() {
    const so=S.samplers.map(s=>'<option value="'+esc(s)+'"'+(s===S.sampler?" selected":"")+">"+esc(s)+"</option>").join("");
    const sch=S.schedulers.map(s=>'<option value="'+esc(s)+'"'+(s===S.scheduler?" selected":"")+">"+esc(s)+"</option>").join("");
    return `
<div class="C">
  <div class="R2">
    <div class="FG"><div class="CL" style="margin-bottom:4px">Sampler</div><select class="SEL" onchange="S.sampler=this.value;scheduleSave()">${so}</select></div>
    <div class="FG"><div class="CL" style="margin-bottom:4px">Scheduler</div><select class="SEL" onchange="S.scheduler=this.value;scheduleSave()">${sch}</select></div>
  </div>
  <div class="CL">Sampling Steps</div>
  <div class="SLR">
    <input type="range" class="RNG" id="stR" min="1" max="150" step="1" value="${S.steps}" style="--p:${S.steps/150*100}%;flex:1" oninput="mui.st(this.value)">
    <input class="SLI" type="number" id="stI" min="1" max="150" value="${S.steps}" onchange="mui.st(this.value)">
  </div>
  <div class="CL">CFG Scale</div>
  <div class="SLR">
    <input type="range" class="RNG" id="cfR" min="0" max="30" step="0.5" value="${S.cfg}" style="--p:${S.cfg/30*100}%;flex:1" oninput="mui.cf(this.value)">
    <input class="SLI" type="number" id="cfI" min="0" max="30" step="0.5" value="${S.cfg}" onchange="mui.cf(this.value)">
  </div>
  <div class="CL" style="margin-top:1px">Seed</div>
  <input class="INP" type="text" placeholder="Vacío = aleatorio" value="${esc(S.seed)}" oninput="S.seed=this.value;scheduleSave()">
</div>`;
  }

  /* ── SECCIÓN: Opciones ──────────────────────────── */
  function rOpcionesSection() {
    const uo=S.upscalers.map(u=>'<option value="'+esc(u)+'"'+(u===S.upscaler?" selected":"")+">"+esc(u)+"</option>").join("");
    const ldModes=["Background Only","Foreground Only","Combined","Foreground to Background"];
    return `
<div class="C">
  <div class="CT">Opciones</div>
  <div class="TR">
    <span class="TL">🔍 Upscale (Hires.fix)</span>
    <label class="TOG"><input type="checkbox" ${S.upscale?"checked":""} onchange="S.upscale=this.checked;mui.tp('cfgUp',this.checked)"><span class="TOGS"></span></label>
  </div>
  <div id="cfgUp" class="SC" style="display:${S.upscale?"block":"none"}">
    <div class="SCL">⚙️ Upscale Config</div>
    <select class="SEL" style="margin-bottom:7px" onchange="S.upscaler=this.value">${uo}</select>
    <div class="R2">
      <div class="FG"><div class="CL">Factor ×</div><input class="INP" type="number" value="${S.upscaleX}" min="1.25" max="4" step="0.25" oninput="S.upscaleX=+this.value"></div>
      <div class="FG"><div class="CL">Denoising</div><input class="INP" type="number" value="${S.upscaleDn}" min="0" max="1" step="0.05" oninput="S.upscaleDn=+this.value"></div>
    </div>
  </div>
  <div class="TR">
    <span class="TL">👤 ADetailer</span>
    <label class="TOG"><input type="checkbox" ${S.adetailer?"checked":""} onchange="S.adetailer=this.checked;mui.tp('cfgAD',this.checked)"><span class="TOGS"></span></label>
  </div>
  <div id="cfgAD" class="SC" style="display:${S.adetailer?"block":"none"}">${rADetailer()}</div>
  <div class="TR">
    <span class="TL">🗺️ Regional Prompter</span>
    <label class="TOG"><input type="checkbox" ${S.rp?"checked":""} onchange="S.rp=this.checked;mui.tp('cfgRP',this.checked)"><span class="TOGS"></span></label>
  </div>
  <div id="cfgRP" class="SC" style="display:${S.rp?"block":"none"}">${rRegionalPrompter()}</div>
  <div class="TR">
    <span class="TL">🕹️ ControlNet</span>
    <label class="TOG"><input type="checkbox" id="cnToggle" ${S.cnUnits.some(u=>u.enabled)?"checked":""} onchange="mui.cnToggle(this.checked)"><span class="TOGS"></span></label>
  </div>
  <div id="cfgCN" class="SC" style="display:${S.cnUnits.some(u=>u.enabled)?"block":"none"}">${rControlNet()}</div>
  <!-- FIX BUG-03: Layer Diffusion con modo y peso configurables -->
  <div class="TR">
    <span class="TL">🌊 Layer Diffusion</span>
    <label class="TOG"><input type="checkbox" ${S.layerDiff?"checked":""} onchange="S.layerDiff=this.checked;mui.tp('cfgLD',this.checked)"><span class="TOGS"></span></label>
  </div>
  <div id="cfgLD" class="SC" style="display:${S.layerDiff?"block":"none"}">
    <div class="SCL">⚙️ Layer Diffusion Config</div>
    <div class="CL" style="margin-bottom:4px">Modo</div>
    <select class="SEL" style="margin-bottom:8px" onchange="S.layerDiffMode=this.value">
      ${ldModes.map(m=>`<option value="${esc(m)}" ${S.layerDiffMode===m?"selected":""}>${esc(m)}</option>`).join("")}
    </select>
    <div class="CL">Weight: <strong id="ldWLbl">${(S.layerDiffWeight||1).toFixed(2)}</strong></div>
    <div class="SLR">
      <input type="range" class="RNG" min="0" max="1" step="0.05"
        value="${S.layerDiffWeight||1}" style="--p:${(S.layerDiffWeight||1)*100}%;flex:1"
        oninput="S.layerDiffWeight=+this.value;this.style.setProperty('--p',(this.value*100)+'%');var l=$('ldWLbl');if(l)l.textContent=(+this.value).toFixed(2)">
    </div>
  </div>
</div>`;
  }

  /* ── TEXT2IMG ─────────────────────────────────────── */
  function rTxt() {
    return rPromptSection() + rModelsSection() + rARSection() + rSamplerSection() + rOpcionesSection();
  }

  /* ── Multi-LoRA list ──────────────────────────────── */
  function rLoraList() {
    if (!S.loras_active.length) {
      return '<div style="color:#4b5563;font-size:12px;padding:6px 0 3px">Ningún LoRA seleccionado</div>';
    }
    return S.loras_active.map((entry, idx) => {
      const lo = S.loras.find(l=>l.n===entry.n)||null;
      const label = lo ? lo.a.slice(0,22) : entry.n.slice(0,22);
      const th = lo && lo.preview.length ? imgTag(lo.preview,"✨") : '<span style="font-size:16px">✨</span>';
      const twc = lo ? (S._civitai[lo.n]||"") : "";
      return `<div class="LR">
        <div class="LR-thumb" data-fb="✨" onclick="mui.changeLora(${idx})">${th}</div>
        <div style="flex:1;overflow:hidden;cursor:pointer" onclick="mui.changeLora(${idx})">
          <div class="LR-name">${esc(label)}</div>
          ${twc?`<div class="TWP">🏷️ ${esc(twc.slice(0,24))}${twc.length>24?"…":""}</div>`:""}
        </div>
        <input class="LR-w" type="number" min="0" max="2" step="0.05" value="${entry.w}"
          oninput="S.loras_active[${idx}].w=parseFloat(this.value)||1;scheduleSave()">
        <button class="LR-del" onclick="mui.removeLora(${idx})">✕</button>
      </div>`;
    }).join("");
  }

  /* ── ADetailer ────────────────────────────────────── */
  function rADetailer() {
    const tabNames = ["1st","2nd","3rd","4th"];
    const slot = S.adSlots[S.adTab];
    const ao = S.adModels.map(m=>'<option value="'+esc(m)+'"'+(m===slot.model?" selected":"")+">"+esc(m)+"</option>").join("");
    return `
<div class="SCL">⚙️ ADetailer — ${tabNames[S.adTab]} Detector</div>
<div class="AD-TABS">
  ${tabNames.map((n,i)=>`
    <button class="AD-TAB ${S.adTab===i?"on":""}" onclick="mui.adTab(${i})">
      ${n}${S.adSlots[i].enabled?'<span class="on-dot"></span>':""}
    </button>`).join("")}
</div>
<div class="RP-CK" style="margin-bottom:9px">
  <input type="checkbox" id="adEn${S.adTab}" ${slot.enabled?"checked":""}
    onchange="S.adSlots[${S.adTab}].enabled=this.checked">
  <label for="adEn${S.adTab}">Habilitar ${tabNames[S.adTab]} detector</label>
</div>
<div class="CL" style="margin-bottom:4px">Modelo de detección</div>
<select class="SEL" style="margin-bottom:8px" onchange="S.adSlots[${S.adTab}].model=this.value">${ao}</select>
<div class="CL" style="margin-bottom:4px">Prompt ADetailer (vacío = usar prompt principal)</div>
<textarea class="NTA" style="min-height:40px;background:#13132a;border:1px solid #1e1e34;border-radius:7px;padding:7px 10px;"
  placeholder="ADetailer prompt…"
  oninput="S.adSlots[${S.adTab}].prompt=this.value">${esc(slot.prompt||"")}</textarea>
<div class="CL" style="margin:5px 0 4px">Negativo ADetailer</div>
<textarea class="NTA" style="min-height:34px;background:#13132a;border:1px solid #1e1e34;border-radius:7px;padding:7px 10px;"
  placeholder="Negativo ADetailer…"
  oninput="S.adSlots[${S.adTab}].neg=this.value">${esc(slot.neg||"")}</textarea>
<div class="R2" style="margin-top:8px">
  <div class="FG"><div class="CL">Confidence</div>
    <input class="INP" type="number" value="${slot.conf}" min="0.1" max="1" step="0.05" oninput="S.adSlots[${S.adTab}].conf=+this.value">
  </div>
  <div class="FG"><div class="CL">Denoising</div>
    <input class="INP" type="number" value="${slot.dn}" min="0" max="1" step="0.05" oninput="S.adSlots[${S.adTab}].dn=+this.value">
  </div>
</div>`;
  }

  /* ── ControlNet ───────────────────────────────────── */
  const CN_PASSTHROUGH = new Set([
    "none","reference_only","reference_adain","reference_adain+attn",
    "ip-adapter_clip_sdxl","ip-adapter_clip_sdxl_plus_vith",
    "ip-adapter_clip_sd15","ip-adapter_face_id","ip-adapter_face_id_plus",
    "ip-adapter_pulid","revision_clipvision","revision_ignore_prompt",
    "inpaint_only","inpaint_only+lama",
  ]);
  const CN_HAS_THRESH = new Set([
    "canny","mlsd","scribble_pidinet","softedge_pidinet","softedge_pidisafe",
    "depth_leres","depth_leres++","normal_bae",
  ]);
  const CN_THRESH_DEFAULTS = {
    canny:   { a:100, b:200, lA:"Low Threshold", lB:"High Threshold" },
    mlsd:    { a:0.1, b:0.1, lA:"Value Threshold", lB:"Distance Threshold" },
    depth_leres:    { a:0, b:0, lA:"Remove Near %", lB:"Remove Background %" },
    "depth_leres++":{ a:0, b:0, lA:"Remove Near %", lB:"Remove Background %" },
    normal_bae:     { a:1, b:1, lA:"", lB:"" },
  };

  function rControlNet() {
    const u = S.cnUnits[S.cnTab];
    const unitNames = ["Unit 0", "Unit 1", "Unit 2"];
    const ppOpts = (S.cnPreprocessors.length > 1 ? S.cnPreprocessors : [
      "none","canny","depth_midas","depth_zoe","depth_leres","hed","lineart_coarse",
      "lineart_realistic","lineart_anime","mlsd","normal_bae","openpose","openpose_face",
      "openpose_faceonly","openpose_full","openpose_hand","dwpose","dw_openpose_full",
      "scribble_hed","scribble_pidinet","softedge_hed","softedge_pidinet","softedge_pidisafe",
      "segmentation","shuffle","tile_resample","tile_colorfix","tile_colorfix+sharp",
      "invert","inpaint_only","inpaint_only+lama","reference_only",
      "ip-adapter_clip_sdxl","ip-adapter_clip_sd15",
    ]).map(p =>
      '<option value="'+esc(p)+'"'+(p===u.preprocessor?" selected":"")+">"+esc(p)+"</option>"
    ).join("");
    const mdlLabel = u.model && u.model !== "none" ? u.model.slice(0,30) : "Ninguno";
    const modes   = ["Balanced","Prefer Prompt","Prefer ControlNet"];
    const resizes = ["Just Resize","Crop and Resize","Resize and Fill"];
    const needsPrep = !CN_PASSTHROUGH.has(u.preprocessor) && u.preprocessor !== "none";
    const hasThresh = CN_HAS_THRESH.has(u.preprocessor);
    const td = CN_THRESH_DEFAULTS[u.preprocessor] || { a:-1, b:-1, lA:"Threshold A", lB:"Threshold B" };
    const dropContent = u.imageB64
      ? `<img src="${u.imageB64}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:9px">
         <div class="CN-DROP-OVR" onclick="event.preventDefault();event.stopPropagation();
           S.cnUnits[${S.cnTab}].imageB64=null;S.cnUnits[${S.cnTab}].preprocessedB64=null;
           mui.cnRefresh()">
           <button style="background:rgba(239,68,68,.85);border:none;border-radius:6px;color:#fff;
             padding:6px 14px;font-size:12px;cursor:pointer;pointer-events:none">✕ Quitar</button>
         </div>`
      : `<div class="CN-DROP-LBL">📁 Toca para subir imagen de referencia<br>
           <span style="font-size:10px;color:#4b5563">Canny · Depth · OpenPose · IP-Adapter…</span>
         </div>`;
    const prevSection = u.preprocessedB64 ? `
<div class="CN-PREV-LBL">✅ Preprocesado con: ${esc(u.preprocessor)}</div>
<div class="CN-PREV">
  <img src="${u.preprocessedB64}" alt="preprocessed">
  <div class="CN-PREV-OVR">
    <button class="CN-PREV-CLR"
      onclick="S.cnUnits[${S.cnTab}].preprocessedB64=null;mui.cnRefresh()">✕ Resetear</button>
  </div>
</div>` : "";
    const threshSection = hasThresh ? `
<div class="CN-THRESH">
  <div class="CL" style="margin-bottom:7px">Parámetros del preprocessor</div>
  <div class="R2">
    <div class="FG"><div class="CL">${td.lA || "Threshold A"}</div>
      <input class="INP" type="number" step="1" value="${u.threshA>=0?u.threshA:td.a}"
        oninput="S.cnUnits[${S.cnTab}].threshA=+this.value">
    </div>
    <div class="FG"><div class="CL">${td.lB || "Threshold B"}</div>
      <input class="INP" type="number" step="1" value="${u.threshB>=0?u.threshB:td.b}"
        oninput="S.cnUnits[${S.cnTab}].threshB=+this.value">
    </div>
  </div>
</div>` : "";
    // Show warning banner if unit is enabled+has model but preprocessor not yet run
    const showPrepWarning = u.enabled && u.model && u.model !== "none"
      && needsPrep && u.imageB64 && !u.preprocessedB64;

    const runBtn = (u.imageB64 && needsPrep) ? `
<button class="CN-RUN-BTN" id="cnRunBtn${S.cnTab}"
  ${u.detecting?"disabled":""}
  style="${!u.preprocessedB64?"background:linear-gradient(135deg,#7c3aed88,#06b6d488);border-color:#7c3aed;":""}"
  onclick="mui.cnRunPrep(${S.cnTab})">
  ${u.detecting
    ? '<div class="SPIN"></div> Procesando…'
    : (u.preprocessedB64
        ? '🔄 Re-ejecutar · '+esc(u.preprocessor)
        : '▶ REQUERIDO: Correr Preprocesador · '+esc(u.preprocessor))}
</button>
${showPrepWarning ? `<div style="background:#f59e0b22;border:1px solid #f59e0b55;border-radius:8px;padding:8px 10px;font-size:11px;color:#fbbf24;margin-bottom:9px">
  ⚠️ Debes correr el preprocesador antes de generar. reForge no puede aplicarlo internamente desde la API.
</div>` : ""}` : "";
    return `
<div class="SCL">🕹️ ControlNet</div>
<div class="CN-TABS">
  ${unitNames.map((n,i)=>`
    <button class="CN-TAB ${S.cnTab===i?"on":""}" onclick="mui.cnTabSwitch(${i})">
      ${n}${S.cnUnits[i].enabled?'<span class="en-dot"></span>':""}
    </button>`).join("")}
</div>
<div class="RP-CK" style="margin-bottom:8px">
  <input type="checkbox" id="cnEn${S.cnTab}" ${u.enabled?"checked":""}
    onchange="S.cnUnits[${S.cnTab}].enabled=this.checked;document.getElementById('cnToggle').checked=S.cnUnits.some(x=>x.enabled)">
  <label for="cnEn${S.cnTab}" style="font-size:13px;color:#e5e7eb;font-weight:500">Habilitar Unit ${S.cnTab}</label>
</div>
<div style="display:flex;gap:10px;margin-bottom:10px">
  <label class="RP-CK" style="margin-bottom:0">
    <input type="checkbox" ${u.pixelPerfect?"checked":""} onchange="S.cnUnits[${S.cnTab}].pixelPerfect=this.checked">
    <span style="font-size:11px;color:#9ca3af">Pixel Perfect</span>
  </label>
  <label class="RP-CK" style="margin-bottom:0">
    <input type="checkbox" ${u.lowVram?"checked":""} onchange="S.cnUnits[${S.cnTab}].lowVram=this.checked">
    <span style="font-size:11px;color:#9ca3af">Low VRAM</span>
  </label>
</div>
<div class="CL" style="margin-bottom:4px">Preprocessor</div>
<select class="SEL" style="margin-bottom:9px"
  onchange="S.cnUnits[${S.cnTab}].preprocessor=this.value;S.cnUnits[${S.cnTab}].preprocessedB64=null;mui.cnRefresh()">${ppOpts}</select>
${threshSection}
<div class="CL" style="margin-bottom:4px">Detect Resolution</div>
<input class="INP" type="number" step="64" min="128" max="2048"
  value="${u.detectRes||512}" style="margin-bottom:9px"
  oninput="S.cnUnits[${S.cnTab}].detectRes=+this.value||512">
<label for="cnFileInp${S.cnTab}" class="CN-DROP ${u.imageB64?"has-img":""}">
  ${dropContent}
</label>
${runBtn}
${prevSection}
<div class="CL" style="margin-bottom:4px">Modelo CN</div>
<div class="MR ${u.model&&u.model!=="none"?"sel":""}" onclick="mui.cnOpenMdl()" style="margin-bottom:9px;min-height:auto;padding:8px 11px">
  <div style="flex:1;font-size:12px;font-weight:600;color:#e5e7eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(mdlLabel)}</div>
  <span style="color:#4b5563;font-size:13px">›</span>
</div>
<div class="CL">Control Weight: <strong id="cnWLbl${S.cnTab}">${u.weight.toFixed(2)}</strong></div>
<div class="SLR">
  <input type="range" class="RNG" min="0" max="2" step="0.05"
    value="${u.weight}" style="--p:${u.weight/2*100}%;flex:1"
    oninput="S.cnUnits[${S.cnTab}].weight=+this.value;this.style.setProperty('--p',(this.value/2*100)+'%');var l=$('cnWLbl${S.cnTab}');if(l)l.textContent=(+this.value).toFixed(2)">
</div>
<div class="R2">
  <div class="FG"><div class="CL">Starting Step</div>
    <input class="INP" type="number" min="0" max="1" step="0.05" value="${u.startStep}"
      oninput="S.cnUnits[${S.cnTab}].startStep=+this.value">
  </div>
  <div class="FG"><div class="CL">Ending Step</div>
    <input class="INP" type="number" min="0" max="1" step="0.05" value="${u.endStep}"
      oninput="S.cnUnits[${S.cnTab}].endStep=+this.value">
  </div>
</div>
<div class="CL" style="margin-bottom:5px">Control Mode</div>
<div class="CN-MODEBTS">
  ${modes.map(m=>`<button class="CN-PPB ${u.mode===m?"on":""}" onclick="S.cnUnits[${S.cnTab}].mode='${m}';mui.cnRefresh()">${m}</button>`).join("")}
</div>
<div class="CL" style="margin-bottom:5px">Resize Mode</div>
<div class="CN-RZBTS">
  ${resizes.map(r=>`<button class="CN-PPB ${u.resize===r?"on":""}" onclick="S.cnUnits[${S.cnTab}].resize='${r}';mui.cnRefresh()">${r}</button>`).join("")}
</div>`;
  }

  /* ── Regional Prompter ────────────────────────────── */
  function rRegionalPrompter() {
    const modes    = ["Attention","Latent"];
    const calcModes = ["Matrix","Mask","Prompt"];
    const splits   = ["Columns","Rows","Random"];
    return `
<div class="SCL">⚙️ Regional Prompter</div>

<div class="CL" style="margin-bottom:4px">Generation Mode</div>
<div class="RP-BTNS">
  ${modes.map(m=>`<button class="RP-BTN ${S.rpMode===m?"on":""}" onclick="S.rpMode='${m}';mui.tp('cfgRP',true)">${m}</button>`).join("")}
</div>

<div class="CL" style="margin-bottom:4px">Calc Mode</div>
<div class="RP-BTNS">
  ${calcModes.map(c=>`<button class="RP-BTN ${(S.rpCalcMode||'Matrix')===c?"on":""}" onclick="S.rpCalcMode='${c}';mui.tp('cfgRP',true)">${c}</button>`).join("")}
</div>

<div class="CL" style="margin-bottom:4px">Main Splitting</div>
<div class="RP-BTNS">
  ${splits.map(s=>`<button class="RP-BTN ${S.rpSplitting===s?"on":""}" onclick="S.rpSplitting='${s}';mui.tp('cfgRP',true)">${s}</button>`).join("")}
</div>

<div class="R2">
  <div class="FG"><div class="CL">Divide Ratio</div>
    <input class="INP" type="text" placeholder="1,1" value="${esc(S.rpRatio)}" oninput="S.rpRatio=this.value;scheduleSave()">
  </div>
  <div class="FG"><div class="CL">Base Ratio</div>
    <input class="INP" type="text" placeholder="0.2" value="${esc(String(S.rpBase))}" oninput="S.rpBase=this.value;scheduleSave()">
  </div>
</div>

<div class="RP-CK">
  <input type="checkbox" id="rpBase" ${S.rpBasePrompt?"checked":""} onchange="S.rpBasePrompt=this.checked;scheduleSave()">
  <label for="rpBase">Use base prompt</label>
</div>
<div class="RP-CK">
  <input type="checkbox" id="rpCommon" ${S.rpCommonPrompt?"checked":""} onchange="S.rpCommonPrompt=this.checked;scheduleSave()">
  <label for="rpCommon">Use common prompt</label>
</div>
<div class="RP-CK">
  <input type="checkbox" id="rpComNeg" ${S.rpComNegPrompt?"checked":""} onchange="S.rpComNegPrompt=this.checked;scheduleSave()">
  <label for="rpComNeg">Use common negative prompt</label>
</div>
<div class="RP-CK">
  <input type="checkbox" id="rpFlip" ${S.rpFlip?"checked":""} onchange="S.rpFlip=this.checked;scheduleSave()">
  <label for="rpFlip">Flip "," and ";"</label>
</div>

<div class="CL" style="margin-top:8px;margin-bottom:4px">Prompt por región</div>
<div style="background:#0a0a18;border:1px solid #06b6d444;border-radius:8px;padding:8px 10px;font-size:11px;color:#22d3ee;margin-bottom:6px;line-height:1.6">
  💡 <strong>Uso:</strong> En el prompt principal separa cada región con <code style="background:#1e1e34;padding:1px 5px;border-radius:3px">BREAK</code><br>
  Ej: <em>common prompt ADDCOMM region1 ADDCOL region2</em><br>
  O simplemente: <em>descripción BREAK región1 BREAK región2</em>
</div>
<textarea class="NTA" style="min-height:72px;background:#13132a;border:1px solid #1e1e34;border-radius:7px;padding:7px 10px;font-size:12px;"
  placeholder="ADDCOMM&#10;prompt común&#10;ADDCOL&#10;región izquierda BREAK región derecha"
  oninput="S.rpTemplate=this.value;scheduleSave()">${esc(S.rpTemplate||"")}</textarea>`;
  }

  /* ── IMG2IMG — v22: completamente expandido con Modelos, ADetailer y CN ── */
  function rI2I() {
    const i2iResizes = ["Just Resize","Crop and Resize","Fill","Latent Upscale"];
    const rzo = i2iResizes.map(r=>`<option value="${esc(r)}" ${S.i2iResizeMode===r?"selected":""}>${esc(r)}</option>`).join("");
    const dropContent = S.i2iImageB64
      ? `<img src="${S.i2iImageB64}" style="max-width:100%;max-height:200px;object-fit:contain;border-radius:9px">
         <div class="I2I-DROP-OVR">
           <button style="background:rgba(239,68,68,.85);border:none;border-radius:6px;color:#fff;padding:8px 18px;font-size:13px;cursor:pointer"
             onclick="event.preventDefault();event.stopPropagation();S.i2iImageB64=null;rerender()">✕ Quitar</button>
         </div>`
      : `<div style="text-align:center;padding:20px">
           <div style="font-size:40px;margin-bottom:8px">🖼️</div>
           <div style="color:#9ca3af;font-size:13px">Toca para subir imagen</div>
           <div style="font-size:11px;color:#4b5563;margin-top:4px">PNG · JPG · WebP</div>
         </div>`;
    // ADetailer aviso si activo
    const adNote = S.adetailer
      ? `<div style="background:#7c3aed22;border:1px solid #7c3aed44;border-radius:8px;padding:7px 10px;font-size:11px;color:#a78bfa;margin-top:6px">
           ✅ ADetailer activo — ${S.adSlots.filter(s=>s.enabled).length} detector(es) configurado(s) desde la pestaña Text2Img
         </div>`
      : `<div style="background:#1a1a2e;border:1px solid #1e1e34;border-radius:8px;padding:7px 10px;font-size:11px;color:#6b7280;margin-top:6px">
           ℹ️ ADetailer desactivado. Actívalo en la pestaña Text2Img para que también se aplique aquí.
         </div>`;
    // ControlNet aviso si activo
    const cnActive = S.cnUnits.some(u=>u.enabled && u.model && u.model !== "none");
    const cnNote = cnActive
      ? `<div style="background:#06b6d422;border:1px solid #06b6d444;border-radius:8px;padding:7px 10px;font-size:11px;color:#22d3ee;margin-top:6px">
           ✅ ControlNet activo — ${S.cnUnits.filter(u=>u.enabled&&u.model&&u.model!=="none").length} unidad(es) configurada(s)
         </div>`
      : "";
    return `
<div class="C">
  <div class="CT">Imagen de referencia</div>
  <label for="i2iFileInp" class="I2I-DROP ${S.i2iImageB64?"has-img":""}">
    ${dropContent}
  </label>
  <div class="R2" style="margin-top:4px">
    <div class="FG">
      <div class="CL">Denoising Strength</div>
      <input class="INP" type="number" value="${S.i2iDn}" min="0" max="1" step="0.05"
        oninput="S.i2iDn=+this.value;scheduleSave()">
    </div>
    <div class="FG">
      <div class="CL">Resize Mode</div>
      <select class="SEL" onchange="S.i2iResizeMode=this.value;scheduleSave()">${rzo}</select>
    </div>
  </div>
</div>
<div class="C">
  <div class="NL" style="color:#06b6d4">✏️ PROMPT DE MODIFICACIÓN</div>
  <textarea class="PTA" id="i2iPTa" placeholder="Describe los cambios que quieres…" style="min-height:60px"
    oninput="S.i2iPrompt=this.value;scheduleSave()">${esc(S.i2iPrompt)}</textarea>
  <hr class="HR">
  <div class="NL">🚫 NEGATIVO</div>
  <textarea class="NTA" placeholder="worst quality, low quality…"
    oninput="S.i2iNeg=this.value;scheduleSave()">${esc(S.i2iNeg||S.neg)}</textarea>
  <hr class="HR">
  <div class="TBAR">
    <button class="TBTN" onclick="mui.i2iCp()" title="Limpiar prompt">🗑️</button>
    <button class="TBTN" onclick="mui.i2iSync()" title="Copiar prompt de Text2Img">⬆️ Sync</button>
  </div>
</div>
${rModelsSection()}
${rARSection()}
${rSamplerSection()}
<div class="C">
  <div class="CT">Opciones Img2Img</div>
  <div class="TR">
    <span class="TL">👤 ADetailer</span>
    <label class="TOG"><input type="checkbox" ${S.adetailer?"checked":""} onchange="S.adetailer=this.checked;rerender()"><span class="TOGS"></span></label>
  </div>
  ${adNote}
  ${S.adetailer?`<div class="SC" style="display:block;margin-top:8px">${rADetailer()}</div>`:""}
  <div class="TR" style="margin-top:10px">
    <span class="TL">🕹️ ControlNet</span>
    <label class="TOG"><input type="checkbox" id="cnToggleI2I" ${cnActive?"checked":""} onchange="mui.cnToggle(this.checked);rerender()"><span class="TOGS"></span></label>
  </div>
  ${cnNote}
  ${cnActive?`<div class="SC" style="display:block;margin-top:8px">${rControlNet()}</div>`:""}
</div>`;
  }

  /* ── TASKS ────────────────────────────────────────── */
  function rTasks() {
    if (!S.history.length) return `
      <div class="TEMPTY"><div class="EI">🎨</div>
        <div style="color:#9ca3af;font-size:14px;font-weight:600;margin-bottom:5px">Sin tareas aún</div>
        <div style="font-size:12px">Genera tu primera imagen en Text2Img o Img2Img</div>
      </div>`;
    return S.history.map(j=>buildCard(j)).join("");
  }

  function buildCard(job) {
    const {id,params,images,status,progress,eta,error}=job;
    const isGen=status==="generating",isDone=status==="done";
    const pct=progress||0;
    const isI2I = params.mode === "img2img";
    const chips=[
      `<span class="CHIP">${params.w}×${params.h}</span>`,
      `<span class="CHIP">${esc(params.sampler)}</span>`,
      `<span class="CHIP">${params.steps}s</span>`,
      `<span class="CHIP HL">CFG ${params.cfg}</span>`,
      `<span class="CHIP">×${params.count}</span>`,
    ];
    if(isI2I)        chips.push(`<span class="CHIP HL">Img2Img dn:${params.dn}</span>`);
    if(params.upscale)   chips.push(`<span class="CHIP HL">Upscale ×${params.upscaleX}</span>`);
    if(params.adetailer) chips.push(`<span class="CHIP HL">ADetailer</span>`);
    if(params.rp)        chips.push(`<span class="CHIP HL">RegPrompt</span>`);
    if(params.layerDiff) chips.push(`<span class="CHIP HL">LayerDiff</span>`);
    const igc=images.length>=4?"G4":images.length===2?"G2":"G1";
    let h=`<div class="TC ${isGen?"TC-G":isDone?"TC-D":"TC-E"}" id="tc-${id}">
      <div class="TC-TOP">
        <div class="TC-SR">
          <span class="TC-BG ${isGen?"BG-G":isDone?"BG-D":"BG-E"}">${isGen?"⏳ Generando…":isDone?"✅ Completado":"❌ Error"}</span>
          <span class="TC-TS">${params.ts}</span>
        </div>
        <div class="TC-MDL">${isI2I?"🖼️":"🎨"} <span>${esc((params.model||"—").replace(/\.[^/.]+$/,"").slice(0,24))}</span>
          ${params.loras&&params.loras!=="—"?`&nbsp;✨ <span>${esc(params.loras.slice(0,22))}</span>`:""}
        </div>
        <div class="TC-P">${esc(params.prompt)}</div>
        <div class="CHIPS">${chips.join("")}</div>`;
    if(isGen) h+=`<div class="GP">
        <div class="GPR">
          <span class="GPCT" id="gpct-${id}">${pct}%</span>
          <span class="GETA" id="geta-${id}">${eta>0?"ETA "+eta+"s":pct>0?"procesando…":"esperando…"}</span>
        </div>
        <div class="GPBG"><div class="GPFG" id="gpfg-${id}" style="width:${pct}%"></div></div>
      </div>
      <div class="LP" id="lp-${id}">
        ${S.liveImg?`<img src="${S.liveImg}">`:`<div class="LP-PH"><div class="SPIN"></div><span>Esperando primer frame…</span></div>`}
      </div>`;
    if(error) h+=`<div style="font-size:12px;color:#f87171;margin-top:4px">⚠️ ${esc(error)}</div>`;
    h+=`</div>`;
    if(isDone&&images.length){
      h+=`<div class="IG ${igc}">`;
      // MEJORA-11: onclick abre lightbox en lugar de nueva pestaña
      images.forEach((src,i)=>{
        h+=`<div class="IW" onclick="mui.lbOpen(${JSON.stringify(images).replace(/'/g,"\\'")},'${escA(src)}')">
          <img src="${src}" loading="lazy">
          <div class="IACT"><button class="IA" onclick="event.stopPropagation();mui.dl('${escA(src)}',${i})">💾</button></div>
        </div>`;
      });
      h+=`</div>`;
    }
    if(!isGen) h+=`<div class="TC-EX">
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <button class="EBTN" style="flex:1" onclick="mui.exp('${id}')"><span id="eico-${id}">▼</span> Ver params</button>
        <button class="EBTN" style="flex:1" onclick="mui.copyParams('${id}')">📋 Copiar params</button>
      </div>
      <div id="prm-${id}" class="PRMS">
        <div class="PR"><span class="PK">Prompt</span><span class="PV">${esc(params.prompt.slice(0,80))}${params.prompt.length>80?"…":""}</span></div>
        <div class="PR"><span class="PK">Negativo</span><span class="PV">${esc((params.neg||"").slice(0,60))}${(params.neg||"").length>60?"…":""}</span></div>
        <div class="PR"><span class="PK">Modelo</span><span class="PV">${esc((params.model||"—").replace(/\.[^/.]+$/,"").slice(0,28))}</span></div>
        ${params.loras&&params.loras!=="—"?`<div class="PR"><span class="PK">LoRAs</span><span class="PV">${esc(params.loras)}</span></div>`:""}
        <div class="PR"><span class="PK">Sampler/Sch</span><span class="PV">${esc(params.sampler)} / ${esc(params.scheduler||"Auto")}</span></div>
        <div class="PR"><span class="PK">Steps / CFG</span><span class="PV">${params.steps} / ${params.cfg}</span></div>
        <div class="PR"><span class="PK">Seed</span><span class="PV">${params.seed}</span></div>
        <div class="PR"><span class="PK">Tamaño</span><span class="PV">${params.w}×${params.h} ×${params.count}</span></div>
        ${params.upscale?`<div class="PR"><span class="PK">Upscaler</span><span class="PV">${esc(params.upscaler)} ×${params.upscaleX}</span></div>`:""}
        ${params.adetailer?`<div class="PR"><span class="PK">ADetailer</span><span class="PV">${esc(params.adSlots?.join(", ")||"")}</span></div>`:""}
        ${params.rp?`<div class="PR"><span class="PK">RegPrompter</span><span class="PV">${esc(params.rpMode)} / ${esc(params.rpSplitting||"")}</span></div>`:""}
        ${params.layerDiff?`<div class="PR"><span class="PK">LayerDiff</span><span class="PV">✓</span></div>`:""}
        ${isI2I?`<div class="PR"><span class="PK">Denoising</span><span class="PV">${params.dn}</span></div>`:""}
      </div>
    </div>`;
    return h+"</div>";
  }

  function updateTaskCard(jobId) {
    const job=S.history.find(j=>j.id===jobId); if(!job) return;
    if(job.status==="generating"){
      const pct=job.progress||0, etar=job.eta||0;
      const fg=$("gpfg-"+jobId),pce=$("gpct-"+jobId),ete=$("geta-"+jobId),lpe=$("lp-"+jobId);
      if(fg) fg.style.width=pct+"%";
      if(pce) pce.textContent=pct+"%";
      if(ete) ete.textContent=etar>0?"ETA "+etar+"s":pct>0?"procesando…":"esperando…";
      if(lpe&&S.liveImg) lpe.innerHTML=`<img src="${S.liveImg}">`;
    } else {
      const el=$("tc-"+jobId); if(!el){rerender();return;}
      const tmp=document.createElement("div"); tmp.innerHTML=buildCard(job);
      el.parentNode.replaceChild(tmp.firstElementChild,el);
    }
    const btn=$("t-tasks"); if(!btn) return;
    const busy=S.history.some(j=>j.status==="generating");
    const dot=btn.querySelector(".dot");
    if(busy&&!dot){const d=document.createElement("span");d.className="dot";btn.appendChild(d);}
    else if(!busy&&dot) dot.remove();
  }

  /* ── EXTRA ────────────────────────────────────────── */
  function rExtra() {
    const stateSize = (() => { try { return (localStorage.getItem("mui_state_v10")||"").length; } catch(e){return 0;} })();
    return `
<div class="C">
  <div class="CT">Debug Info</div>
  <div style="font-size:12px;color:#6b7280;line-height:1.9">
    <div>📱 Dispositivo: <span style="color:#e5e7eb">${MOBILE?"Móvil":"PC"}</span></div>
    <div>📐 Viewport: <span style="color:#e5e7eb">${getVW()}×${getVH()}</span></div>
    <div>🔍 Body zoom: <span style="color:#f59e0b">${getBodyZoom().toFixed(3)}</span></div>
    <div>🎨 Modelos: <span style="color:#e5e7eb">${S.models.length}</span></div>
    <div>✨ LoRAs: <span style="color:#e5e7eb">${S.loras.length}</span></div>
    <div>📋 Historial: <span style="color:#e5e7eb">${S.history.length}</span></div>
    <div>💾 Estado guardado: <span style="color:#e5e7eb">${stateSize > 0 ? (stateSize/1024).toFixed(1)+" KB":"—"}</span></div>
    <div>⏱️ Datos cargados: <span style="color:#e5e7eb">${S._dataLoaded?new Date(S._dataTs).toLocaleTimeString("es"):"—"}</span></div>
  </div>
  <div class="ABR" style="margin-top:10px">
    <button class="AB" onclick="mui.refresh(true)">🔄 Recargar forzado</button>
    <button class="AB" onclick="S.history=[];mui.tab('tasks')" style="color:#f87171;border-color:#ef444433">🗑️ Limpiar historial</button>
  </div>
  <div class="ABR" style="margin-top:6px">
    <button class="AB" onclick="mui.clearSaved()" style="color:#f59e0b;border-color:#f59e0b33">⚠️ Borrar estado guardado</button>
  </div>
</div>`;
  }

  /* ══ MODALS ══════════════════════════════════ */
  function fillMdl(f) {
    const el=$("mdlL"), cnt=$("mdlC"); if(!el) return;
    if(!S.models.length){
      el.innerHTML=`<div style="color:#6b7280;text-align:center;padding:22px;font-size:13px">⚠️ Sin modelos.
        <button style="margin-top:8px;background:#7c3aed22;border:1px solid #7c3aed44;color:#a78bfa;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:12px" onclick="mui.refresh(true)">🔄 Reintentar</button></div>`;
      return;
    }
    const flt=(f||"").toLowerCase();
    const list=flt?S.models.filter(m=>(m.t||"").toLowerCase().includes(flt)):S.models;
    if(cnt) cnt.textContent="("+list.length+"/"+S.models.length+")";
    el.innerHTML=list.map(m=>{
      const lbl=(m.t||"").replace(/\.[^/.]+$/,"").slice(0,36);
      const sel=m.t===S.model;
      const th=m.preview.length?imgTag(m.preview,"🎨"):'<span style="font-size:18px">🎨</span>';
      return `<div class="MI ${sel?"on":""}" onclick="mui.pm('${escA(m.t)}')">
        <div class="MITH" data-fb="🎨">${th}</div>
        <div class="MI-I"><div class="MIT">${esc(lbl)}</div>
          ${m.hash?`<div style="font-size:10px;color:#4b5563">#${m.hash.slice(0,8)}</div>`:""}
        </div>${sel?'<span class="MIC">✓</span>':""}
      </div>`;
    }).join("")||'<div style="color:#6b7280;text-align:center;padding:14px;font-size:12px">Sin resultados</div>';
  }

  let _lorSlot = -1;

  async function fillLorAsync(f) {
    const el=$("lorL"), cnt=$("lorC"); if(!el) return;
    const all=[{n:"",a:"— Ninguno —",preview:[]}].concat(S.loras);
    const flt=(f||"").toLowerCase();
    const list=flt?all.filter(l=>(l.a||l.n||"").toLowerCase().includes(flt)):all;
    if(cnt) cnt.textContent="("+(list.length-1)+"/"+S.loras.length+")";
    const curN = _lorSlot >= 0 && _lorSlot < S.loras_active.length
      ? S.loras_active[_lorSlot].n : "";
    el.innerHTML=list.map(l=>{
      const sel=l.n===curN;
      const th=l.preview&&l.preview.length?imgTag(l.preview,"✨"):'<span style="font-size:18px">✨</span>';
      const twc=l.n?S._civitai[l.n]:"";
      const twHtml=twc!=null&&twc
        ?`<div style="font-size:10px;color:#a78bfa;margin-top:2px">🏷️ ${esc(twc.slice(0,26))}${twc.length>26?"…":""}</div>`
        :(l.n&&S._civitai[l.n]===undefined
          ?`<div id="twld-${uid()}" data-lname="${escA(l.n)}" style="font-size:10px;color:#4b5563;font-style:italic">cargando…</div>`
          :"");
      return `<div class="MI ${sel?"on":""}" onclick="mui.plSlot('${escA(l.n)}')">
        <div class="MITH" data-fb="✨">${th}</div>
        <div class="MI-I"><div class="MIT">${esc(l.a||l.n||"Ninguno")}</div>${twHtml}</div>
        ${sel?'<span class="MIC">✓</span>':""}
      </div>`;
    }).join("");
    list.filter(l=>l.n&&S._civitai[l.n]===undefined).slice(0,12).forEach(l=>{
      fetchTriggers(l).then(tw=>{
        el.querySelectorAll('[data-lname="'+escA(l.n)+'"]').forEach(div=>{
          div.removeAttribute("data-lname");
          if(tw){ div.style.color="#a78bfa"; div.style.fontStyle=""; div.textContent="🏷️ "+tw.slice(0,26)+(tw.length>26?"…":""); }
          else   div.remove();
        });
      });
    });
  }

  /* ══ HELPERS ══════════════════════════════════ */
  // MEJORA-10: botón Generate/Stop
  function updateGenBtn() {
    const btn=$("muiGB"),txt=$("muiGT"); if(!btn||!txt) return;
    if (S.busy) {
      btn.disabled = false;
      btn.classList.add("stop-btn");
      $("muiPB").style.width = S.progress + "%";
      txt.innerHTML = '<div class="SPIN"></div> '+S.progress+'% — '+T.stop;
    } else {
      btn.disabled = false;
      btn.classList.remove("stop-btn");
      $("muiPB").style.width = "0%";
      const isI2I = S.tab === "img2img";
      txt.innerHTML = isI2I ? "🖼️ Img2Img" : "⚡ Generar";
    }
  }

  let _nt;
  function notify(msg,err) {
    const el=$("muiToast"); if(!el) return;
    el.textContent=msg; el.className="show"+(err?" err":"");
    clearTimeout(_nt); _nt=setTimeout(()=>el.classList.remove("show"),3200);
  }

  function refreshLoraList() {
    const el=$("loraList"); if(!el) return;
    el.innerHTML=rLoraList();
  }

  /* ══ LIGHTBOX ════════════════════════════════
     MEJORA-11: visor de imágenes inline con navegación
  ═════════════════════════════════════════════ */
  let _lbImages = [], _lbIdx = 0;

  /* ══ PUBLIC API ══════════════════════════════ */
  window.S = S;
  window.snap8 = snap8;
  window.scheduleSave = scheduleSave;
  window.rerender = rerender;
  window.mui = {
    open() {
      let m=document.querySelector("meta[name=viewport]");
      if(!m){m=document.createElement("meta");m.name="viewport";document.head.appendChild(m);}
      m.content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover";
      const ov=$("muiOv"); ov.classList.add("open"); applySize();
      rerender(); loadData();
    },
    close(){ $("muiOv").classList.remove("open"); },
    refresh(force){ notify(T.reloading); loadData(force||false); },
    tab(t){
      S.tab=t;
      document.querySelectorAll(".TAB").forEach(b=>b.classList.remove("on"));
      const b=$("t-"+t);if(b)b.classList.add("on");
      rerender();
      updateGenBtn();
    },
    ar(k){ S.ar=k; scheduleSave(); rerender(); },
    st(v){ S.steps=clamp(parseInt(v)||20,1,150); const r=$("stR"),i=$("stI"); if(r){r.value=S.steps;r.style.setProperty("--p",(S.steps/150*100)+"%");} if(i)i.value=S.steps; scheduleSave(); },
    // FIX BUG-08: CFG ahora permite 0 (para LCM/Turbo)
    cf(v){ S.cfg=clamp(parseFloat(v)||0,0,30); const r=$("cfR"),i=$("cfI"); if(r){r.value=S.cfg;r.style.setProperty("--p",(S.cfg/30*100)+"%");} if(i)i.value=S.cfg; scheduleSave(); },
    tp(id,show){
      const el=$(id); if(!el) return;
      el.style.display=show?"block":"none";
      if (show) {
        if (id==="cfgAD") el.innerHTML=rADetailer();
        if (id==="cfgRP") el.innerHTML=rRegionalPrompter();
        if (id==="cfgCN") el.innerHTML=rControlNet();
        if (id==="cfgLD") {} // ya se renderiza como parte de rOpcionesSection
      }
    },
    adTab(i){ S.adTab=i; const el=$("cfgAD"); if(el) el.innerHTML=rADetailer(); },

    // ── Checkpoint ──────────────────────────────
    om(){ const s=$("mdlS");if(s)s.value="";fillMdl("");$("mdlM").classList.add("open"); },
    fm(v){ fillMdl(v); },
    async pm(t){
      this.cm("mdlM");
      S._modelChanging = true; rerender(); notify(T.loadingModel);
      try {
        await POST("/sdapi/v1/options",{sd_model_checkpoint:t});
        S.model=t; S._modelChanging=false;
        notify(T.modelLoaded+" — "+t.replace(/\.[^/.]+$/,"").slice(0,22));
        scheduleSave();
      } catch(e){ S._modelChanging=false; notify(T.modelError,true); }
      rerender();
    },

    // ── Multi-LoRA ──────────────────────────────
    addLora(){
      if (S.loras_active.length >= 4){ notify(T.maxLoras,true); return; }
      _lorSlot = -1;
      const s=$("lorS");if(s)s.value="";
      fillLorAsync("");
      $("lorM").classList.add("open");
    },
    changeLora(idx){
      _lorSlot = idx;
      const s=$("lorS");if(s)s.value="";
      fillLorAsync("");
      $("lorM").classList.add("open");
    },
    removeLora(idx){
      S.loras_active.splice(idx,1);
      refreshLoraList(); scheduleSave();
    },
    async plSlot(n){
      if (!n) {
        if (_lorSlot >= 0 && _lorSlot < S.loras_active.length) {
          S.loras_active.splice(_lorSlot, 1);
        }
        this.cm("lorM");
        refreshLoraList(); return;
      }
      const loraObj = S.loras.find(l => l.n === n);
      let tw = S._civitai[n];
      if (tw === undefined && loraObj) { tw = await fetchTriggers(loraObj); }
      this.cm("lorM");
      if (tw && tw.trim()) {
        const clean = tw.trim();
        if (!S.prompt.includes(clean)) {
          S.prompt = S.prompt
            ? S.prompt.trimEnd().replace(/,\s*$/, "") + ", " + clean
            : clean;
        }
        requestAnimationFrame(() => {
          const ta = $("mTa");
          if (ta) { ta.value = S.prompt; ta.dispatchEvent(new Event("input", { bubbles: true })); }
        });
        notify("🏷️ Trigger words: " + clean.slice(0, 30) + (clean.length > 30 ? "…" : ""));
      } else if (tw !== undefined && !tw) { notify(T.noTriggers); }
      if (_lorSlot >= 0 && _lorSlot < S.loras_active.length) {
        S.loras_active[_lorSlot].n = n;
      } else {
        S.loras_active.push({ n, w: 1.0 });
      }
      refreshLoraList(); scheduleSave();
    },
    fl(v){ fillLorAsync(v); },
    cm(id){ $(id).classList.remove("open"); },

    // FIX BUG-05: Embedding funcional
    addEmbedding(){
      const emb = prompt("Nombre del embedding/TI (ej: bad_prompt_version2):");
      if (!emb || !emb.trim()) return;
      S.prompt = S.prompt
        ? S.prompt.trimEnd().replace(/,\s*$/, "") + ", (" + emb.trim() + ":1.0)"
        : "(" + emb.trim() + ":1.0)";
      const ta = $("mTa");
      if (ta) { ta.value = S.prompt; }
      notify("✅ Embedding añadido: " + emb.trim().slice(0,20));
      scheduleSave();
    },

    // ── Img2Img ──────────────────────────────────
    i2iImgLoad(input){
      const file = input.files && input.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) { notify(T.onlyImages, true); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        S.i2iImageB64 = e.target.result;
        input.value = "";
        rerender();
        notify("🖼️ Imagen cargada para Img2Img");
      };
      reader.onerror = () => notify(T.imgError, true);
      reader.readAsDataURL(file);
    },
    i2iCp(){ S.i2iPrompt = ""; const ta=$("i2iPTa"); if(ta) ta.value=""; },
    i2iSync(){ S.i2iPrompt = S.prompt; const ta=$("i2iPTa"); if(ta) ta.value=S.prompt; notify("⬆️ Prompt sincronizado"); },

    // ── ControlNet ──────────────────────────────
    cnToggle(checked) {
      if (!checked) S.cnUnits.forEach(u => u.enabled = false);
      else S.cnUnits[0].enabled = true;
      const el = $("cfgCN");
      if (el) { el.style.display = checked ? "block" : "none"; el.innerHTML = rControlNet(); }
    },
    cnTabSwitch(i) { S.cnTab = i; const el = $("cfgCN"); if (el) el.innerHTML = rControlNet(); },
    cnRefresh() { const el = $("cfgCN"); if (el) el.innerHTML = rControlNet(); },
    cnOpenMdl() { fillCnMdl(""); $("cnMdlM").classList.add("open"); },
    cnfm(v) { fillCnMdl(v); },
    cnPickMdl(mdl) {
      S.cnUnits[S.cnTab].model = mdl;
      this.cm("cnMdlM"); this.cnRefresh();
      notify("🕹️ CN Model: " + mdl.slice(0, 24));
    },
    cnImgLoad(input) {
      const file = input.files && input.files[0];
      const unit = parseInt(input.dataset.unit) || 0;
      if (!file) return;
      if (!file.type.startsWith("image/")) { notify(T.onlyImages, true); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        S.cnUnits[unit].imageB64 = e.target.result;
        S.cnUnits[unit].preprocessedB64 = null;
        input.value = "";
        this.cnRefresh();
        notify(T.imgLoaded + unit);
      };
      reader.onerror = () => notify(T.imgError, true);
      reader.readAsDataURL(file);
    },
    async cnRunPrep(unitIdx) {
      const u = S.cnUnits[unitIdx];
      if (!u.imageB64) { notify("⚠️ Sube una imagen primero", true); return; }
      if (!u.preprocessor || u.preprocessor === "none") { notify("⚠️ Selecciona un preprocessor primero", true); return; }
      u.detecting = true; this.cnRefresh(); notify("🔄 Ejecutando " + u.preprocessor + "…");
      const imgB64 = u.imageB64.includes(",") ? u.imageB64.split(",")[1] : u.imageB64;
      const thA = u.threshA !== undefined && u.threshA >= 0 ? u.threshA : -1;
      const thB = u.threshB !== undefined && u.threshB >= 0 ? u.threshB : -1;
      const detectBody = {
        controlnet_module: u.preprocessor, controlnet_input_images: [imgB64],
        controlnet_processor_res: u.detectRes || 512,
        controlnet_threshold_a: thA, controlnet_threshold_b: thB,
      };
      const detectPaths = ["/controlnet/detect","/sdapi/v1/controlnet/detect","/api/controlnet/detect"];
      let result = null, lastErr = "";
      for (const path of detectPaths) {
        try {
          const r = await fetch(BASE + path, {
            method: "POST", headers: H(), credentials: "include",
            body: JSON.stringify(detectBody), signal: AbortSignal.timeout(60000),
          });
          if (r.ok) { result = await r.json(); break; }
          else if (r.status === 404) { lastErr = "404 en " + path; continue; }
          else { lastErr = "HTTP " + r.status + " en " + path; break; }
        } catch(e) { lastErr = e.message; if (e.name !== "AbortError") continue; break; }
      }
      if (result && result.images && result.images.length > 0) {
        const p64 = result.images[0];
        u.preprocessedB64 = p64.startsWith("data:") ? p64 : "data:image/png;base64," + p64;
        notify("✅ Preprocesado listo — " + u.preprocessor);
      } else {
        u.preprocessedB64 = null;
        notify("ℹ️ Preview no disponible ("+lastErr+"). Forge aplicará el preprocessor durante la generación.", false);
      }
      u.detecting = false; this.cnRefresh();
    },
    openCN() {
      const el = $("cfgCN"); if (!el) return;
      if (!S.cnUnits.some(u => u.enabled)) S.cnUnits[0].enabled = true;
      const tog = $("cnToggle"); if (tog) tog.checked = true;
      el.style.display = "block"; el.innerHTML = rControlNet();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    },

    // ── Generate / Stop ─────────────────────────
    async genOrStop(){
      if (S.busy) { await stopGeneration(); }
      else if (S.tab === "img2img") { await generateI2I(); }
      else { await generate(); }
    },
    async gen(){ await generate(); },

    // ── Tasks / Cards ────────────────────────────
    exp(id){ const p=$("prm-"+id),ico=$("eico-"+id);if(!p||!ico)return;const open=p.classList.toggle("open");ico.textContent=open?"▲":"▼"; },

    // MEJORA-07: copiar parámetros como JSON
    copyParams(jobId){
      const job = S.history.find(j=>j.id===jobId); if(!job) return;
      const txt = JSON.stringify(job.params, null, 2);
      navigator.clipboard&&navigator.clipboard.writeText(txt).then(()=>notify(T.paramsCopied));
    },

    dl(src, idx) {
      try {
        fetch(src).then(r => r.blob()).then(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = "sd_" + Date.now() + "_" + idx + ".png";
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
        }).catch(() => { window.open(src, "_blank"); });
      } catch(e) { window.open(src, "_blank"); }
    },

    // ── Lightbox ─────────────────────────────────
    lbOpen(images, activeSrc){
      _lbImages = Array.isArray(images) ? images : [activeSrc];
      _lbIdx = _lbImages.indexOf(activeSrc);
      if (_lbIdx < 0) _lbIdx = 0;
      this._lbRender();
      $("muiLB").classList.add("open");
    },
    _lbRender(){
      const img = $("muiLBImg"); if(!img) return;
      img.src = _lbImages[_lbIdx]||"";
      const prev = $("muiLBPrev"), next = $("muiLBNext");
      if(prev) prev.disabled = _lbIdx === 0;
      if(next) next.disabled = _lbIdx === _lbImages.length - 1;
    },
    lbNav(dir){
      _lbIdx = clamp(_lbIdx + dir, 0, _lbImages.length - 1);
      this._lbRender();
    },
    lbDl(){ if(_lbImages[_lbIdx]) this.dl(_lbImages[_lbIdx], _lbIdx); },
    lbClose(){ $("muiLB").classList.remove("open"); },

    // ── Prompts aleatorios — MEJORA-04: 50+ ideas ──
    rp(){
      const ideas=[
        // Anime/Illustration
        "(anime coloring:1.1),(dramatic lighting:1.1),1girl,clouds,looking at viewer,seductive smile,green eyes,high ponytail,masterpiece",
        "1girl,white sundress,field of lavender,golden hour,dreamy,soft bokeh,detailed,Studio Ghibli style",
        "1boy,samurai armor,cherry blossoms,katana,cinematic composition,ink wash style,masterpiece",
        "chibi,2girls,pastel colors,sweets,cafe,cute,high quality,digital illustration",
        "1girl,maid outfit,gothic lolita,roses,moonlight,dramatic shadows,hyperdetailed",
        "anime girl,cyberpunk city,neon hair,holographic clothes,rain,reflections,futuristic",
        "1girl,shrine maiden,autumn leaves,japanese architecture,peaceful,soft light",
        "dynamic action pose,1girl,magic spell,particle effects,fantasy,vibrant colors",
        // Realistic/Photo
        "professional portrait,young woman,dramatic side lighting,sharp focus,bokeh background",
        "cinematic still,overcrowded Tokyo station,rush hour,long exposure,motion blur,golden hour",
        "aerial photography,mountain range,misty valleys,sunrise,ultra wide,hyperrealistic",
        "close-up portrait,elderly man,weathered face,deep wrinkles,black and white,documentary style",
        "food photography,ramen bowl,steam rising,overhead shot,studio lighting,hyperdetailed",
        "underwater photography,coral reef,tropical fish,dappled sunlight,vibrant colors",
        // Landscape/Environment
        "cyberpunk city at night,neon signs,rain reflections,cinematic,ultra detailed",
        "ancient ruins,jungle overgrowth,golden light shafts,adventure,detailed environment",
        "cozy cabin interior,fireplace,snowstorm outside,warm lighting,hygge aesthetic",
        "surreal landscape,floating islands,waterfalls,magic crystals,epic scale,fantasy",
        "desert at sunset,sand dunes,camel silhouettes,warm gradient sky,minimalist",
        "Scandinavian fjord,autumn colors,reflection,fog,moody atmosphere,photorealistic",
        "space station interior,astronaut,earth through window,zero gravity,detailed sci-fi",
        "enchanted forest,glowing mushrooms,fairy lights,magical mist,fantasy illustration",
        // Characters
        "muscular knight,full plate armor,epic lighting,dynamic pose,detailed,RPG character design",
        "wizard in library,ancient scrolls,magical glow,long beard,atmospheric,fantasy",
        "steampunk inventor,workshop,gears,goggles,brass machinery,Victorian era",
        "post-apocalyptic survivor,gas mask,wasteland,dust storm,cinematic,gritty",
        "elegant ballgown,palace ballroom,chandelier,period drama,oil painting style",
        "street performer,crowd,street photography,candid,reportage style,dramatic moment",
        // Concept Art
        "mecha robot,battle damage,rain,city ruins,concept art,cinematic composition",
        "alien creature,bioluminescent,deep ocean,mysterious,detailed design,science fiction",
        "dragon,mountain peak,storm clouds,lightning,epic scale,high fantasy",
        "futuristic spaceship,hangar bay,crew,hard sci-fi,technical detail,concept art",
      ];
      S.prompt=ideas[Math.floor(Math.random()*ideas.length)];
      const ta=$("mTa");if(ta)ta.value=S.prompt;
      scheduleSave();
    },
    cp(){ S.prompt=""; const ta=$("mTa");if(ta)ta.value=""; scheduleSave(); },
    cpy(){ navigator.clipboard&&navigator.clipboard.writeText(S.prompt).then(()=>notify(T.copied)); },

    clearSaved(){
      try { localStorage.removeItem("mui_state_v10"); notify("🗑️ Estado guardado borrado"); } catch(e){}
    },
  };

  /* ── ControlNet model modal fill ── */
  function fillCnMdl(f) {
    const el = $("cnMdlL"), cnt = $("cnMdlC"); if (!el) return;
    const all = [{ n: "none", lbl: "— Ninguno —" }].concat(
      S.cnModels.filter(m => m !== "none").map(m => ({ n: m, lbl: m }))
    );
    const flt = (f || "").toLowerCase();
    const list = flt ? all.filter(m => m.lbl.toLowerCase().includes(flt)) : all;
    if (cnt) cnt.textContent = "(" + (list.length - 1) + "/" + (S.cnModels.length - 1) + ")";
    const cur = S.cnUnits[S.cnTab].model || "none";
    el.innerHTML = list.map(m => {
      const sel = m.n === cur;
      return `<div class="MI ${sel ? "on" : ""}" onclick="mui.cnPickMdl('${escA(m.n)}')">
        <div class="MITH" data-fb="🕹️" style="background:linear-gradient(135deg,#06b6d433,#22d3ee22)">
          <span style="font-size:18px">🕹️</span>
        </div>
        <div class="MI-I"><div class="MIT">${esc(m.lbl.slice(0, 38))}</div></div>
        ${sel ? '<span class="MIC">✓</span>' : ""}
      </div>`;
    }).join("") || '<div style="color:#6b7280;text-align:center;padding:16px;font-size:12px">Sin modelos CN</div>';
  }

  /* ══ INIT ════════════════════════════════════ */
  function init() {
    loadState(); // MEJORA-03: restaurar estado persistido
    const st=document.createElement("style"); st.id="muiCSS"; st.textContent=CSS; document.head.appendChild(st);
    const d=document.createElement("div"); d.id="muiRoot"; d.innerHTML=HTML;
    document.documentElement.appendChild(d);

    const rsz=()=>{ if($("muiOv")?.classList.contains("open")) applySize(); };
    if(window.visualViewport) window.visualViewport.addEventListener("resize",rsz);
    window.addEventListener("orientationchange",()=>setTimeout(rsz,150));
    window.addEventListener("resize",rsz);

    // Atajos de teclado: Escape cierra lightbox o overlay
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        if ($("muiLB")?.classList.contains("open")) { mui.lbClose(); return; }
        if ($("muiOv")?.classList.contains("open")) { mui.close(); }
      }
      // Flechas navegan el lightbox
      if ($("muiLB")?.classList.contains("open")) {
        if (e.key === "ArrowLeft")  mui.lbNav(-1);
        if (e.key === "ArrowRight") mui.lbNav(1);
      }
    });

    if(MOBILE) setTimeout(()=>{ mui.open(); const f=$("muiFab");if(f)f.classList.add("hidden"); },700);
    console.log("[SD Mobile UI v10] ✓ mobile:"+MOBILE+" zoom:"+getBodyZoom().toFixed(3));
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();
