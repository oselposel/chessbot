# Stockfish 19 Lite, single-threaded WASM

Unmodified upstream release `nmrugg/stockfish.js` tag `v19.0.0`:
https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.0

Stockfish.js © 2026 Chess.com, LLC. Based on Stockfish by T. Romstad,
M. Costalba, J. Kiiski, G. Linscott and other contributors. Licensed
under GPLv3; the full license is provided in `Copying.txt` and is unchanged.
Upstream notices in the JavaScript loader are preserved.

This directory supplies equivalent access to the corresponding source:

- `stockfish.js-v19.0.0-source.zip`: complete upstream source and build scripts
  from https://codeload.github.com/nmrugg/stockfish.js/zip/refs/tags/v19.0.0
- `nn-61e7af4bb97d.nnue`: the exact Lite NNUE network, by the contributors
  credited in the upstream README (sscg13/Stockfish, sf19-1mb).
  Downloaded from https://tests.stockfishchess.org/api/nn/nn-61e7af4bb97d.nnue
  This is the network embedded in the distributed WASM, not an extra runtime download.

To rebuild, extract the source ZIP, copy the provided NNUE file into its
`src/` directory, install Emscripten 3.1.7 and the standard build tools
described in the upstream README, and run from the extracted root:

```
node build.js --lite --single-threaded
```

The build script also supports `--all --only-lite-single` for release naming.
See `build.js --help` and `src/Makefile` for the complete configuration.
Chessbot uses the official JS/WASM release assets without modification and
does not compile the engine during app builds. Source/network downloads
are provided for redistribution and rebuilding, not loaded by the app.

SHA-256:

```
d3344124ab067fb0b90ee77873bb8e9fbf5fc01bc525fe714b0f942581e889e6 stockfish-19-lite-single.js
57ac2d72312aba346760e3f173f687a8c211208e97a87268436f7f0e10bb5387 stockfish-19-lite-single.wasm
b03663b37fde782309ff18069c031f037b91f9364eb4ea7246b7a466f1b10d1c stockfish.js-v19.0.0-source.zip
61e7af4bb97d51eeeb25d322916f86513b5cd3a827ce189c98c6e31946f99e5b nn-61e7af4bb97d.nnue
```
