import gradio as gr
import modules.scripts as scripts
from modules import script_callbacks

class MobileUIScript(scripts.Script):
    def title(self):
        return "Mobile UI"

    def show(self, is_img2img):
        return scripts.AlwaysVisible

    def ui(self, is_img2img):
        return []


def on_ui_tabs():
    pass


def on_app_started(demo, app):
    pass


script_callbacks.on_app_started(on_app_started)
