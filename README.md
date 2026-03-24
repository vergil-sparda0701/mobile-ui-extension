# 📱 Mobile UI Extension
### Stable Diffusion WebUI (Forge / Automatic1111)

Una interfaz móvil inspirada en **tensor.art** para SD WebUI Forge y AUTOMATIC1111.

---

## ✨ Características

- 📱 **Interfaz móvil completa** — Diseño oscuro estilo tensor.art
- 🎨 **Text2Img** — Prompt positivo/negativo con toolbar (aleatorio, limpiar, copiar)
- 🖼️ **Img2Img** — Carga de imágenes para variaciones
- ⚙️ **Settings** — Aspect ratio (2:3, 3:2, 1:1, custom), pasos, CFG, seed, sampler
- 🔧 **Modelos** — Selector de checkpoint con cambio en caliente
- ✨ **LoRA** — Selector con control de peso deslizante
- 🔄 **Progreso en tiempo real** — Barra de progreso durante la generación
- 🖼️ **Galería de resultados** — Vista de imágenes generadas
- 🔍 **Upscale / ADetailer / Layer Diffusion** — Toggles rápidos
- 🎲 **Prompt aleatorio** — Ideas de prompts integradas

---

## 🚀 Instalación

### Método 1 — Instalar desde URL (recomendado)
1. Abre SD WebUI
2. Ve a **Extensions** → **Install from URL**
3. Pega la URL del repositorio
4. Haz clic en **Install**
5. Reinicia la WebUI

### Método 2 — Manual
1. Descarga o clona este repositorio
2. Copia la carpeta `mobile-ui-extension` a:
   ```
   stable-diffusion-webui/extensions/mobile-ui-extension/
   ```
3. Reinicia la WebUI

---

## 📁 Estructura del repositorio

```
mobile-ui-extension/
├── scripts/
│   └── mobile_ui.py          # Script principal (Python/Gradio)
├── javascript/
│   └── mobile_ui.js          # UI completa (se inyecta automáticamente)
└── README.md
```

---

## 🎮 Uso

1. Después de instalar, verás un botón **📱 Mobile UI** en la esquina inferior derecha
2. Haz clic para abrir la interfaz móvil en pantalla completa
3. Escribe tu prompt, ajusta los settings y presiona **⚡ Generate**
4. Las imágenes aparecen en la galería de resultados

---

## ⚙️ Compatibilidad

| WebUI | Estado |
|-------|--------|
| Forge | ✅ Probado |
| AUTOMATIC1111 v1.9+ | ✅ Compatible |
| ComfyUI | ❌ No compatible |

---

## 🛠️ Tecnología

- JavaScript vanilla (sin dependencias externas)
- Usa la **API REST de A1111** (`/sdapi/v1/`)
- Fuente: [Sora](https://fonts.google.com/specimen/Sora) via Google Fonts
- Sin React, sin bundler — funciona directamente

---

## 📝 Notas

- La extensión **no reemplaza** la interfaz original — la agrega como overlay
- El cambio de modelo puede tardar según el tamaño del checkpoint
- Compatible con extensiones como ADetailer (los toggles activan el parámetro en el payload)

---

## 🐛 Problemas conocidos

- El tab Img2Img está en desarrollo (UI lista, funcionalidad pendiente)
- Layer Diffusion requiere tener la extensión instalada en la WebUI

---

*Desarrollado como extensión de Stable Diffusion WebUI*
