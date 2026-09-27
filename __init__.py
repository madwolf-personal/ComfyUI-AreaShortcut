from .area_shortcut import AreaShortcut

NODE_CLASS_MAPPINGS = {
    "AreaShortcut": AreaShortcut,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AreaShortcut": "Area Shortcut",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
