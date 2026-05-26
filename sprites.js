'use strict';
// Sprite indices map into public/assets/icons64.png — a clean 16-column grid, 64px per cell.
// (Pixel-doubled from the uploaded 32px set so alignment is exact and rendering stays crisp.)
const COLS = 16, SIZE = 64;
function pos(idx){ return { x:(idx%COLS)*SIZE, y:Math.floor(idx/COLS)*SIZE }; }
module.exports = { COLS, SIZE, pos };
