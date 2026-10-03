# Country flag asset provenance

These 257 SVG files are copied without redesign from the existing `flags/` directory of `semitrack00-sys/ticash-app-web` (local audited web reference `d3c3fcb`). They are bundled for offline country display, not used as a coverage catalog. Coverage still comes exclusively from `/flupflap/mobile-topups/countries`.

The widget loads only two-letter ISO asset names and falls back to the visible ISO text if an asset is unavailable. There are no external SVG resource references. Original source assets remain unchanged.

The phone picker also covers Ascension Island (`AC`) and Tristan da Cunha (`TA`). Their bundled `sh-ac.svg` and `sh-ta.svg` flags are copied from [flag-icons](https://github.com/lipis/flag-icons/tree/086f7e97d657358203916dbe84f61c2bccaa81eb/flags/4x3), with its MIT license in `assets/flags/FLAG_ICONS_LICENSE.txt`. The flag widget maps these two region codes to those local asset names. No runtime downloads are needed.
