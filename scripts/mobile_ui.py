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

def on_app_started(demo, app: FastAPI):
    @app.get("/mui/v1/scan_gallery")
    async def api_scan_gallery(limit: int = 100):
        try:
            files = scan_folders(limit)
            results = []
            for f in files:
                # Solo leer metadatos de los primeros 50 para no ralentizar la respuesta
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

script_callbacks.on_app_started(on_app_started)
