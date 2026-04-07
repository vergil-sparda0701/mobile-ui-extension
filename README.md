# 📱 Mobile UI Extension — Full SD Studio

### Stable Diffusion WebUI (Forge / Automatic1111)

A professional, high-performance mobile interface inspired by **tensor.art** for Stable Diffusion WebUI. Designed for seamless generation, history management, and model optimization directly from your smartphone.

---

## ✨ Features (Latest Version)

* 📱 **Premium Mobile Design** — Dark mode, glassmorphism, and smooth animations optimized for touch.
* 🎨 **Text2Img & Img2Img** — Full support for both generation modes with persistent history.
* 🖼️ **Advanced Gallery & Server Scan** — Scan your internal server outputs and synchronize your entire history.
* 🔍 **Smart Lightbox** — Premium image viewer with full-history navigation (arrows) and real-time metadata display.
* 🔀 **Total Remix** — Restore *everything* from a historical image: Checkpoint, LoRAs (even if hidden in prompt), ADetailer slots, and Hires fix.
* 🛡️ **ADetailer Robustness** — Fuzzy model matching. If a model (like face_yolov9c) is missing, it automatically selects the best available version.
* 🌐 **Civitai Vergil Mod Integration** — Sync covers, trigger words, and scan models directly from the mobile UI with real-time logs.
* 🧩 **Deep Integration** — Full support for:
    * **ADetailer** (Multiple slots)
    * **ControlNet** (Unit 0, 1, 2 with preprocessor run)
    * **Regional Prompter** (Matrix/Mask/Prompt modes)
    * **Layer Diffusion** (Foreground/Background/Blended)
    * **Hires.fix** (Custom upscalers and denoising)

---

## 🎮 Recommended Usage

### 🔄 The "Perfect Remix" Workflow
1.  Go to the **🖼️ Galería** tab and click 🔄 to sync your server images.
2.  Open any image in the **Lightbox**.
3.  Click **🔀 Remezclar**. All parameters, including LoRAs and ADetailer models, will be restored.
4.  If a LoRA was used in the prompt but not in the metadata, the UI will detect it automatically!

### 🏺 Civitai Synchronization
1.  If you downloaded new models and they don't have covers or trigger words, go to the **Extra** tab.
2.  Click **🔍 Scan Metadata**.
3.  Monitor the **Live Logs** console to see progress in real-time.

### 👥 ADetailer Optimization
*   Use the **AD-TABS** to configure up to 4 simultaneous detectors (e.g., Face + Body).
*   The UI handles model mismatches: it will find the closest version of a detector if you switch servers.

---

## 🛠️ Technology

* Vanilla JavaScript (no external dependencies)
* Uses the **A1111 REST API** (`/sdapi/v1/`)
* Font: [Sora](https://fonts.google.com/specimen/Sora) via Google Fonts
* No React, no bundler — runs directly


---

## 🚀 Installation

### Method 1 — Install from URL (Recommended)
1. Open SD WebUI.
2. Go to **Extensions** → **Install from URL**.
3. Paste: `https://github.com/vergil-sparda0701/mobile-ui-extension`
4. Click **Install** and **Apply and Restart UI**.

### Method 2 — Manual
1. Clone the repo into `extensions/mobile-ui-extension/`.
2. Restart the WebUI.

---

## ⚙️ Compatibility

| WebUI               | Status           |
| ------------------- | ---------------- |
| Forge               | ✅ Fully Tested   |
| AUTOMATIC1111 v1.9+ | ✅ Compatible     |
| ComfyUI             | ❌ Not compatible |

---

## 📝 Notes

* The extension **does not replace** the original interface — it adds it as an overlay
* Model switching may take time depending on checkpoint size
* Compatible with extensions like ADetailer (toggles enable parameters in the payload)

---

## 🐛 Known Issues

* The Img2Img tab is under development (UI ready, functionality pending)
* Layer Diffusion requires the extension to be installed in the WebUI

---

## Preview

![UI Preview](./Mobile_UI_shots/screen1.jpg)
![UI Preview2](./Mobile_UI_shots/screen2.jpg)
![UI Preview3](./Mobile_UI_shots/screen3.jpg)
![UI Preview4](./Mobile_UI_shots/screen4.jpg)

---

## ☕ Support the project

If this extension saves you time and you'd like to support its development, a coffee is always appreciated!

Every contribution helps keep the project maintained and motivates new features. Thank you! 🙏

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/danielgs20019)

---

*Developed as a premium Stable Diffusion WebUI extension for the mobile community.*
