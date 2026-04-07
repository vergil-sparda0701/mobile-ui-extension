import os
import json
import time
from pathlib import Path
from PIL import Image
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
import modules.scripts as scripts
from modules import script_callbacks, shared, paths

class MobileUIScript(scripts.Script):
    def title(self):
        return "Mobile UI"

    def show(self, is_img2img):
        return scripts.AlwaysVisible

    def ui(self, is_img2img):
        return []

def scan_folders(limit=100):
    """Escanea las carpetas de salida estándar de SD WebUI."""
    # Intentar obtener rutas de configuración de SD
    out_dirs = [
        shared.opts.outdir_samples or shared.opts.outdir_txt2img_samples or os.path.join(paths.data_path, "outputs/txt2img-images"),
        shared.opts.outdir_img2img_samples or os.path.join(paths.data_path, "outputs/img2img-images")
    ]
    
    found = []
    for d in out_dirs:
        if not os.path.exists(d): continue
        for root, dirs, files in os.walk(d):
            for f in files:
                if f.lower().endswith((".png", ".jpg", ".webp")):
                    fp = os.path.join(root, f)
                    try:
                        st = os.stat(fp)
                        found.append({
                            "path": os.path.abspath(fp),
                            "mtime": st.st_mtime,
                            "size": st.st_size
                        })
                    except: pass

    # Ordenar por fecha (más reciente primero)
    found.sort(key=lambda x: x["mtime"], reverse=True)
    return found[:limit]

def get_png_info(path):
    """Extrae parámetros de generación de la imagen."""
    try:
        with Image.open(path) as img:
            info = img.info.get("parameters") or img.info.get("Description") or ""
            return info
    except:
        return ""

# --- Civitai Extension Vergil Mod support ---
CIVITAI_LOG_LINES = []

def on_app_started(demo, app: FastAPI):
    # Intentar importar el módulo lib de la extensión de Civitai
    civitai = None
    try:
        import civitai.lib as c_lib
        civitai = c_lib
        # Parchear el log de civitai para capturar mensajes para la Mobile UI
        _orig_log = civitai.log
        def _mui_log_patch(msg):
            _orig_log(msg)
            ts = time.strftime('%H:%M:%S')
            CIVITAI_LOG_LINES.append(f"[{ts}] {msg}")
            if len(CIVITAI_LOG_LINES) > 100: CIVITAI_LOG_LINES.pop(0)
        civitai.log = _mui_log_patch
    except Exception: pass

    @app.get("/mui/v1/scan_gallery")
    async def api_scan_gallery(limit: int = 100):
        try:
            files = scan_folders(limit)
            results = []
            for f in files:
                info = get_png_info(f["path"]) if len(results) < 50 else ""
                results.append({
                    "src": f"/file={f['path']}",
                    "ts": time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(f["mtime"])),
                    "info": info,
                    "mtime": f["mtime"]
                })
            return JSONResponse(content={"images": results})
        except Exception as e:
            return JSONResponse(content={"error": str(e)}, status_code=500)

    @app.post("/mui/v1/civitai/scan")
    async def api_civitai_scan():
        if not civitai:
            return JSONResponse(content={"error": "Extension de Civitai (Vergil Mod) no detectada. Verifique que esté instalada."}, status_code=404)
        
        import threading
        import civitai.lib as c_lib
        def run():
            try:
                c_lib.log("── Scan profundo desde Mobile UI ──")
                # Escaneamos lista de recursos
                res_list = c_lib.load_resource_list()
                
                # 1. Info (.json)
                c_lib.log("Buscando metadatos (.json) faltantes...")
                # Reutilizamos la lógica del script original pero adaptada por si no hay acceso al script directo
                hashes_info = [r['hash'] for r in res_list if not r.get('hasInfo')]
                if hashes_info:
                    results = c_lib.get_all_by_hash_with_cache(hashes_info)
                    if results:
                        # Replicamos el guardado de JSON
                        for r in results:
                            if not r: continue
                            for f in r.get('files', []):
                                sha256 = f.get('hashes', {}).get('SHA256', "").lower()
                                if sha256 in hashes_info:
                                    # Guardar JSON (simplificado)
                                    # En un entorno ideal, llamaríamos a load_info() del script.py
                                    # pero como redundancia usamos los datos de la API de civitai
                                    pass 
                
                # 2. Previews
                c_lib.log("Buscando portadas faltantes...")
                hashes_prev = [r['hash'] for r in res_list if not r.get('hasPreview')]
                if hashes_prev:
                    results = c_lib.get_all_by_hash_with_cache(hashes_prev)
                    if results:
                        for r in results:
                            if not r: continue
                            # ... lógica de descarga ...
                            pass
                
                # NOTA: Por simplicidad y evitar errores de duplicidad de código,
                # lo ideal es llamar a las funciones del script.py si están en sys.modules
                vergil_script = None
                for name, mod in sys.modules.items():
                    if "Civitai_Extension_Vergil_Mod" in name and hasattr(mod, "load_info"):
                        vergil_script = mod
                        break
                
                if vergil_script:
                    vergil_script.load_info()
                    vergil_script.load_preview()
                    c_lib.log("── Scan Mobile UI: Éxito usando Script Original ──")
                else:
                    c_lib.log("⚠️ No se pudo encontrar el script original para el scan profundo.")

            except Exception as e:
                c_lib.log(f"Error en scan: {str(e)}")

        threading.Thread(target=run, daemon=True).start()
        return JSONResponse(content={"status": "started"})

    @app.get("/mui/v1/civitai/log")
    async def api_civitai_log():
        return JSONResponse(content={"log": "\n".join(reversed(CIVITAI_LOG_LINES))})

script_callbacks.on_app_started(on_app_started)
