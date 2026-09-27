class AreaShortcut:
    """
    A pure UI marker node.

    It has no outputs and is never part of any output node's dependency
    chain, so ComfyUI's executor never actually runs it -- it just sits on
    the graph holding up to ten saved 16:9 regions (one per digit 0-9,
    drawn by the user on the real canvas via the accompanying JS
    extension), keyed in node.properties.regions. Pressing a digit key
    jumps/zooms the canvas to that digit's saved region, if any. A single
    node covers all ten shortcuts -- the shortcut_key widget just selects
    which slot "Set Region" currently edits.
    """

    NAME = "AreaShortcut"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "shortcut_key": (
                    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
                    {"default": "1"},
                ),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "utils"
    OUTPUT_NODE = False

    def noop(self, shortcut_key):
        return {}
